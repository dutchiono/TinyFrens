import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Message,
  PermissionFlagsBits,
} from 'discord.js';
import { loadConfig } from './config.js';
import { createAppContext } from './context.js';
import { createDbConnection } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { matchBlocklist, matchFilter, recordStrike } from './domain/telegram-moderation.js';
import {
  fetchGithubProgress,
  generateTelegramReply,
  renderTelegramUpdateBriefing,
  telegramHelpText,
  telegramHelpTopicRequest,
  telegramUpdateBriefingRequest,
} from './integrations/telegram.js';
import { parseRepo } from './integrations/github.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

  const db = createDbConnection(config.DB_PATH, { readonly: config.DB_READ_ONLY });
  if (!config.DB_READ_ONLY) runMigrations(db);
  const context = createAppContext(config, db);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  let alertUserId = config.DISCORD_ALERT_USER_ID;
  let heartbeat: NodeJS.Timeout | undefined;
  const historyLimit = Math.max(1, Math.min(200, config.TELEGRAM_ISSUE_HISTORY));

  const reportFailure = async (key: string, title: string, error: unknown): Promise<void> => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(title, error);
    await context.operationalAlerts.report(`discord:${key}`, title, detail);
    if (!alertUserId || !client.isReady()) return;
    try {
      const user = await client.users.fetch(alertUserId);
      await user.send(`🚨 **TinyFrens failure**\n\n${title}\n\n${detail.slice(0, 1_000)}`);
    } catch (alertError) {
      console.error('Discord owner alert delivery failed', alertError);
    }
  };

  const handleMessage = async (message: Message): Promise<void> => {
    if (!message.inGuild() || message.author.bot || !message.content.trim()) return;
    context.repos.telegram.rememberCommunityMessage({
      platform: 'discord',
      room_id: `dc:${message.guildId}:${message.channelId}`,
      message_id: message.id,
      user_id: message.author.id,
      display_name: message.member?.displayName || message.author.globalName || message.author.username,
      content: message.content,
      created_at: Math.floor(message.createdTimestamp / 1_000),
    }, historyLimit);
    const key = `dc:${message.guildId}`;
    if (config.DISCORD_MODERATION && !message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      const violation = matchBlocklist(context.repos.telegram, key, message.content);
      if (violation) {
        await message.delete();
        const strikes = recordStrike(
          context.repos.telegram,
          key,
          message.author.id,
          violation,
          Math.floor(context.now())
        );
        if (strikes === 1) {
          await message.channel.send({
            content: `⚠️ <@${message.author.id}>, that message was removed for blocklisted content. Warning 1/2; repeating it results in a ban.`,
            allowedMentions: { users: [message.author.id] },
          });
        } else {
          await message.guild.members.ban(message.author.id, {
            reason: `Repeated TinyFrens blocklist violation: ${violation}`,
          });
          await message.channel.send({
            content: `🚫 <@${message.author.id}> was banned for repeated blocklist violations.`,
            allowedMentions: { users: [message.author.id] },
          });
        }
        return;
      }

      const response = matchFilter(context.repos.telegram, key, message.content);
      if (response) {
        await message.reply({ content: response, allowedMentions: { repliedUser: false } });
        return;
      }
    }

    const botId = client.user?.id;
    if (!botId || !message.mentions.users.has(botId)) return;
    context.rateLimiter.limit(`dc-mention:${message.channelId}`, 30, 3600, context.now());
    let normalized = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '@TinyFrensBot');
    for (const [id, mentioned] of message.mentions.users) {
      if (id !== botId) normalized = normalized.replace(new RegExp(`<@!?${id}>`, 'g'), `@${mentioned.username}`);
    }
    const helpTopic = telegramHelpTopicRequest(normalized, 'TinyFrensBot');
    const briefing = telegramUpdateBriefingRequest(normalized, 'TinyFrensBot');
    let answer: string;
    if (helpTopic) {
      answer = telegramHelpText(helpTopic).replace(/<[^>]+>/g, '');
    } else if (briefing) {
      const [owner, repo] = parseRepo(config.GITHUB_REPO || 'dutchiono/TinyFrens');
      const progress = await fetchGithubProgress(owner, repo, await context.githubAuth.token(owner, repo), fetch, context.now);
      answer = renderTelegramUpdateBriefing(progress, briefing.target, repo, briefing.hours, Math.floor(context.now()));
    } else {
      const conversation = context.repos.telegram.listCommunityMessages('discord', key, historyLimit)
        .map(row => ({ name: row.display_name, text: row.content, date: row.created_at }));
      try {
        answer = await generateTelegramReply(
          conversation,
          config.GEMINI_API_KEY || config.GOOGLE_API_KEY,
          config.GEMINI_MODEL
        );
      } catch {
        answer = 'AI chat is unavailable right now. `/help`, `/game`, `/show`, and `/status` still work.';
      }
    }
    await message.reply({ content: answer.slice(0, 2_000), allowedMentions: { repliedUser: false, parse: [] } });
  };

  const handleJoin = async (member: GuildMember): Promise<void> => {
    if (member.user.bot) return;
    const channel = member.guild.channels.cache.find(
      candidate => candidate.isTextBased() && candidate.name === 'tinyfrens'
    );
    if (channel?.isSendable()) {
      await channel.send({
        content: `👋 Welcome <@${member.id}>. Use \`/game\` in **#scrap-yard** when you’re ready to join a Scrap Run.`,
        allowedMentions: { users: [member.id] },
      });
    }
  };

  client.once(Events.ClientReady, async readyClient => {
    console.log(`TinyFrens Discord Gateway ready as ${readyClient.user.tag}`);
    const markReady = () => {
      context.repos.telegram.setIndexerState('discord_gateway_heartbeat', String(Math.floor(context.now())));
      context.repos.telegram.setIndexerState('discord_gateway_revision', config.APP_REVISION || 'unknown');
    };
    markReady();
    heartbeat = setInterval(markReady, 30_000);
    heartbeat.unref();
    if (!alertUserId) {
      try {
        const application = await readyClient.application.fetch();
        const owner = application.owner;
        if (owner && 'id' in owner) alertUserId = owner.id;
      } catch (error) {
        await context.operationalAlerts.report(
          'discord:owner-discovery',
          'Discord owner discovery failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  });
  client.on(Events.MessageCreate, message => {
    void handleMessage(message).catch(error => reportFailure('message', 'Discord message handling failed', error));
  });
  client.on(Events.GuildMemberAdd, member => {
    void handleJoin(member).catch(error => reportFailure('member-join', 'Discord welcome failed', error));
  });
  client.on(Events.Error, error => void reportFailure('client', 'Discord Gateway client failed', error));
  client.on(Events.ShardError, error => void reportFailure('shard', 'Discord Gateway shard failed', error));

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Stopping Discord Gateway after ${signal}`);
    if (heartbeat) clearInterval(heartbeat);
    client.destroy();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', signal => void shutdown(signal));
  process.once('SIGTERM', signal => void shutdown(signal));

  try {
    await client.login(config.DISCORD_BOT_TOKEN);
  } catch (error) {
    await reportFailure('startup', 'Discord Gateway startup failed', error);
    client.destroy();
    db.close();
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}

export { main };
