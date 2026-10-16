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
    if (!config.DISCORD_MODERATION || !message.inGuild() || message.author.bot || !message.content.trim()) return;
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    const key = `dc:${message.guildId}`;
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
    }
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
