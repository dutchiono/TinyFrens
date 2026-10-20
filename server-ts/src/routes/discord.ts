import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { REST, Routes } from 'discord.js';
import { AppContext } from '../context.js';
import { verifyDiscordInteraction } from '../crypto/signatures.js';
import { AccountLinkRequiredError, discordPet } from '../domain/account.js';
import { discordGameHelpText, discordHelpText, discordShowHelpText } from '../domain/community-help.js';
import { requestSync, startCommunityLink } from '../domain/device-sync.js';
import { communityCompanion } from '../domain/telegram-companion.js';
import { renderDiscordScrap } from '../domain/discord-scrap.js';
import { fileCommunityIssue } from '../domain/community-issues.js';
import { addBlocklist, addFilter } from '../domain/telegram-moderation.js';
import { companionGif } from '../media/telegram-gif.js';
import { parseRepo } from '../integrations/github.js';
import { fetchGithubProgress, renderTelegramUpdateBriefing } from '../integrations/telegram.js';
import {
  expireStaleScrapRun,
  getOpenScrapRun,
  joinScrapRun,
  resolveScrapRun,
  startScrapRun,
} from '../domain/telegram-scrap.js';
import {
  createDiscordRest,
  DISCORD_ADMINISTRATOR,
  DISCORD_BAN_MEMBERS,
  DISCORD_MANAGE_MESSAGES,
  DISCORD_MODERATE_MEMBERS,
  discordBanMember,
  discordDeleteMessage,
  discordTimeoutMember,
  setupDiscordGuild,
} from '../integrations/discord-api.js';
import { exchangeDiscordCode } from '../integrations/discord.js';

type DiscordObject = Record<string, unknown>;

function interactionUser(data: DiscordObject): DiscordObject {
  const member = data.member as DiscordObject | undefined;
  return (member?.user as DiscordObject | undefined) || (data.user as DiscordObject | undefined) || {};
}

function commandOption(command: DiscordObject, name: string): unknown {
  const options = Array.isArray(command.options) ? command.options as DiscordObject[] : [];
  return options.find(option => option.name === name)?.value;
}

function resolvedUser(command: DiscordObject, userId: string): DiscordObject {
  const resolved = command.resolved as DiscordObject | undefined;
  const users = resolved?.users as DiscordObject | undefined;
  return users?.[userId] as DiscordObject | undefined || { id: userId };
}

function resolvedMember(command: DiscordObject, userId: string): DiscordObject {
  const resolved = command.resolved as DiscordObject | undefined;
  const members = resolved?.members as DiscordObject | undefined;
  return members?.[userId] as DiscordObject | undefined || {};
}

function hasPermission(value: unknown, permission: bigint): boolean {
  try {
    const permissions = BigInt(String(value || '0'));
    return (permissions & DISCORD_ADMINISTRATOR) !== 0n || (permissions & permission) !== 0n;
  } catch {
    return false;
  }
}

function message(content: string, options: { ephemeral?: boolean; users?: string[]; components?: unknown[] } = {}) {
  return {
    type: 4,
    data: {
      content,
      flags: options.ephemeral ? 64 : undefined,
      components: options.components,
      allowed_mentions: { parse: [], users: options.users || [] },
    },
  };
}

function updateMessage(content: string, components: unknown[]) {
  return { type: 7, data: { content, components, allowed_mentions: { parse: [] } } };
}

function deferred(ephemeral = false) {
  return { type: 5, data: { flags: ephemeral ? 64 : undefined } };
}

async function editOriginal(
  rest: REST,
  interaction: DiscordObject,
  content: string,
  files?: Array<{ data: Buffer; name: string }>
): Promise<void> {
  const applicationId = String(interaction.application_id || '');
  const token = String(interaction.token || '');
  await rest.patch(Routes.webhookMessage(applicationId, token, '@original'), {
    body: { content: content.slice(0, 2_000), allowed_mentions: { parse: [] } },
    files,
  });
}

function chatKey(guildId: string, channelId: string): string {
  return `dc:${guildId}:${channelId}`;
}

async function applyDiscordWarning(
  context: AppContext,
  rest: REST,
  interaction: DiscordObject,
  targetId: string,
  reason: string,
  sourceMessageId?: string
): Promise<{ content: string; users: string[] }> {
  const guildId = String(interaction.guild_id || '');
  const channelId = String(interaction.channel_id || '');
  const command = interaction.data as DiscordObject;
  const invoker = interactionUser(interaction);
  const target = resolvedUser(command, targetId);
  const targetMember = resolvedMember(command, targetId);
  if (!guildId || !channelId) throw new Error('Warnings can only be used inside a server.');
  if (!hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MODERATE_MEMBERS)) {
    throw new Error('You need Timeout Members to use this command.');
  }
  if (target.bot === true) throw new Error('The warning ladder is for members, not bots.');
  if (targetId === String(invoker.id || '')) throw new Error('You cannot warn yourself.');
  if (hasPermission(targetMember.permissions, DISCORD_ADMINISTRATOR)) throw new Error('TinyFrens will not warn a server administrator.');

  if (sourceMessageId) await discordDeleteMessage(rest, channelId, sourceMessageId);
  const key = `dc:${guildId}`;
  const previous = context.repos.telegram.getModerationWarnings(key, targetId);
  const count = Math.min(3, (previous?.warnings ?? 0) + 1);
  const now = Math.floor(context.now());
  let mutedUntil = previous?.muted_until ?? null;
  let content: string;
  if (count === 1) {
    content = `⚠️ <@${targetId}> warning 1/3. Please keep it civil.`;
  } else if (count === 2) {
    mutedUntil = now + 10 * 60;
    await discordTimeoutMember(rest, guildId, targetId, new Date(mutedUntil * 1000), reason || 'TinyFrens warning 2/3');
    content = `🔇 <@${targetId}> warning 2/3. Muted for 10 minutes.`;
  } else {
    await discordBanMember(rest, guildId, targetId, reason || 'TinyFrens warning 3/3');
    content = `🚫 <@${targetId}> warning 3/3. Banned from the server.`;
  }
  if (reason) content += `\nReason: ${reason}`;
  context.repos.telegram.recordModerationWarning({
    chat_id: key,
    user_id: targetId,
    warnings: count,
    last_reason: reason,
    warned_by: String(invoker.id || ''),
    muted_until: mutedUntil,
    source_message_id: null,
    updated_at: now,
  });
  return { content, users: [targetId] };
}

async function handleDiscordCommand(
  context: AppContext,
  rest: REST,
  interaction: DiscordObject
): Promise<Record<string, unknown>> {
  const command = interaction.data as DiscordObject;
  const name = String(command.name || '').toLowerCase();
  const guildId = String(interaction.guild_id || '');
  const channelId = String(interaction.channel_id || '');
  const user = interactionUser(interaction);

  if (name === 'start' || name === 'help') return message(discordHelpText(), { ephemeral: true });
  if (name === 'gamehelp') return message(discordGameHelpText(), { ephemeral: true });
  if (name === 'showhelp') return message(discordShowHelpText(), { ephemeral: true });
  if (name === 'myid') return message(`Your Discord user ID: \`${String(user.id || '')}\``, { ephemeral: true });

  if (name === 'link') {
    try {
      const code = String(commandOption(command, 'code') || '');
      if (code) {
        const pet = discordPet(context, user, true);
        requestSync(context, pet.id, code, `Discord @${String(user.username || user.id || 'member')}`);
        return message('Link requested. Approve it on the TinyFrens device that created the code.', { ephemeral: true });
      }
      try {
        discordPet(context, user);
        return message('Discord is already linked to your TinyFrens account.', { ephemeral: true });
      } catch (error) {
        if (!(error instanceof AccountLinkRequiredError)) throw error;
      }
      const pet = discordPet(context, user, true);
      const label = `Discord @${String(user.username || user.id || 'member')}`;
      const link = startCommunityLink(context, pet.id, 'discord', label);
      const url = new URL(context.config.TELEGRAM_MINIAPP_URL.split('#', 1)[0]);
      url.searchParams.set('community-link', link.token);
      url.hash = 'account';
      return message('Open this on the device where you already use TinyFrens, then confirm the link. It expires in 10 minutes.', {
        ephemeral: true,
        components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Link my TinyFrens account', url: url.toString() }] }],
      });
    } catch (error) {
      return message(error instanceof Error ? error.message : 'TinyFrens could not request that link.', { ephemeral: true });
    }
  }

  if (name === 'show') {
    const slot = Number(commandOption(command, 'slot') || 1);
    void (async () => {
      try {
        const pet = discordPet(context, user);
        const companion = await communityCompanion(context, pet.id, slot);
        await editOriginal(rest, interaction, `🐾 **${String(companion.name).slice(0, 100)}** · slot ${slot}`, [{
          data: companionGif(companion.companion),
          name: `tinyfren-slot-${slot}.gif`,
        }]);
      } catch (error) {
        await editOriginal(rest, interaction, error instanceof Error ? error.message : 'TinyFrens could not verify that NFT right now.');
      }
    })().catch(error => void context.operationalAlerts.report('discord:show', 'Discord NFT post failed', error instanceof Error ? error.message : String(error)));
    return deferred();
  }

  if (name === 'progress') {
    void (async () => {
      const repoValue = context.config.GITHUB_REPO || 'dutchiono/TinyFrens';
      const [owner, repo] = parseRepo(repoValue);
      const progress = await fetchGithubProgress(owner, repo, await context.githubAuth.token(owner, repo));
      await editOriginal(rest, interaction, renderTelegramUpdateBriefing(progress, null, repo));
    })().catch(async error => {
      void context.operationalAlerts.report('discord:progress', 'Discord progress lookup failed', error instanceof Error ? error.message : String(error));
      await editOriginal(rest, interaction, 'I could not verify the latest TinyFrens updates right now.').catch(() => undefined);
    });
    return deferred();
  }

  if (name === 'issue') {
    void (async () => {
      context.rateLimiter.limit(`dc-issue:${String(user.id || '')}`, 5, 3600, context.now());
      const title = String(commandOption(command, 'title') || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const details = String(commandOption(command, 'details') || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 1_800);
      const stored = context.repos.telegram.listCommunityMessages(
        'discord',
        chatKey(guildId, channelId),
        context.config.TELEGRAM_ISSUE_HISTORY
      );
      const messages = stored.map(row => ({ name: row.display_name, text: row.content }));
      if (title || details) {
        messages.push({
          name: String(user.global_name || user.username || 'requester'),
          text: ['Issue request', title && `Focus: ${title}`, details && `Extra context: ${details}`]
            .filter(Boolean)
            .join('. '),
        });
      }
      const footer = `_Filed from Discord channel \`${channelId}\` by <@${String(user.id || '')}> through TinyFrens, summarising ${stored.length} recent message(s). Please edit if the summary missed something._`;
      const result = await fileCommunityIssue(context, {
        messages,
        chatTitle: `Discord channel ${channelId}`,
        linkTarget: chatKey(guildId, channelId),
        footer,
      });
      await editOriginal(rest, interaction, `✅ Opened issue #${result.number}: ${result.title}\n${result.url}`);
    })().catch(async error => {
      const detail = error instanceof Error ? error.message : 'Unknown failure';
      void context.operationalAlerts.report('discord:issue', 'Discord issue filing failed', detail);
      await editOriginal(rest, interaction, `I could not open that issue: ${detail.slice(0, 300)}`).catch(() => undefined);
    });
    return deferred();
  }

  if (command.type === 3 && name === 'warn message') {
    const targetMessageId = String(command.target_id || '');
    const messages = (command.resolved as DiscordObject | undefined)?.messages as DiscordObject | undefined;
    const targetMessage = messages?.[targetMessageId] as DiscordObject | undefined;
    const author = targetMessage?.author as DiscordObject | undefined;
    const targetId = String(author?.id || '');
    if (!targetId) return message('Could not identify that message author.', { ephemeral: true });
    try {
      const result = await applyDiscordWarning(context, rest, interaction, targetId, '', targetMessageId);
      return message(result.content, { users: result.users });
    } catch (error) {
      return message(error instanceof Error ? error.message : 'The warning failed.', { ephemeral: true });
    }
  }

  if (name === 'game') {
    if (!guildId || !channelId) return message('Run `/game` in a server channel.', { ephemeral: true });
    const key = chatKey(guildId, channelId);
    const now = Math.floor(context.now());
    expireStaleScrapRun(context.db, key, now);
    const existing = getOpenScrapRun(context.db, key);
    if (existing) {
      return message('A Scrap Run is already open in this channel. Use the existing card so the group stays in one place.', { ephemeral: true });
    }
    const state = startScrapRun(
      context.db, key, String(user.id || ''),
      String(user.global_name || user.username || 'Fren'), now, context.random()
    ).state;
    const card = renderDiscordScrap(state);
    return message(card.content, { components: card.components });
  }

  if (name === 'warn') {
    const targetId = String(commandOption(command, 'member') || '');
    const reason = String(commandOption(command, 'reason') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    try {
      const result = await applyDiscordWarning(context, rest, interaction, targetId, reason);
      return message(result.content, { users: result.users });
    } catch (error) {
      return message(error instanceof Error ? error.message : 'The warning failed.', { ephemeral: true });
    }
  }

  if (name === 'unwarn') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MODERATE_MEMBERS)) {
      return message('You need Timeout Members to clear warnings.', { ephemeral: true });
    }
    const targetId = String(commandOption(command, 'member') || '');
    const removed = context.repos.telegram.clearModerationWarnings(`dc:${guildId}`, targetId);
    return message(removed ? `✅ Cleared all warnings for <@${targetId}>.` : `<@${targetId}> has no TinyFrens warnings.`, { users: [targetId] });
  }

  if (name === 'ban') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_BAN_MEMBERS)) {
      return message('You need Ban Members to use this command.', { ephemeral: true });
    }
    const targetId = String(commandOption(command, 'member') || '');
    const reason = String(commandOption(command, 'reason') || 'TinyFrens moderator ban').replace(/\s+/g, ' ').trim().slice(0, 200);
    try {
      await discordBanMember(rest, guildId, targetId, reason);
      return message(`🚫 Banned <@${targetId}>.\nReason: ${reason}`, { users: [targetId] });
    } catch (error) {
      return message(`Could not ban that member: ${error instanceof Error ? error.message : 'Discord rejected the action.'}`, { ephemeral: true });
    }
  }

  if (name === 'bot') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MANAGE_MESSAGES)) {
      return message('You need Manage Messages to flag suspected bots.', { ephemeral: true });
    }
    const targetId = String(commandOption(command, 'member') || '');
    const target = resolvedUser(command, targetId);
    context.repos.telegram.markSuspectedBot({
      chat_id: `dc:${guildId}`,
      user_id: targetId,
      username: String(target.username || '').slice(0, 32),
      display_name: String(target.global_name || target.username || '').slice(0, 80),
      flagged_by: String(user.id || ''),
      source_message_id: null,
      flagged_at: Math.floor(context.now()),
    });
    return message(`⚠️ <@${targetId}> was marked as a suspected bot for moderator review.`, { users: [targetId] });
  }

  if (name === 'unbot') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MANAGE_MESSAGES)) {
      return message('You need Manage Messages to clear suspected bots.', { ephemeral: true });
    }
    const targetId = String(commandOption(command, 'member') || '');
    const removed = context.repos.telegram.clearSuspectedBot(`dc:${guildId}`, targetId);
    return message(removed ? `✅ Cleared the suspected-bot mark from <@${targetId}>.` : `<@${targetId}> was not marked as a suspected bot.`, { users: [targetId] });
  }

  if (name === 'filter') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MANAGE_MESSAGES)) {
      return message('You need Manage Messages to configure filters.', { ephemeral: true });
    }
    const key = `dc:${guildId}`;
    const action = String(commandOption(command, 'action') || 'list');
    const trigger = String(commandOption(command, 'trigger') || '');
    try {
      if (action === 'set') {
        const saved = addFilter(context.repos.telegram, key, trigger, commandOption(command, 'response'), String(user.id || ''), Math.floor(context.now()));
        return message(`✅ Saved filter \`${saved}\`.`);
      }
      if (action === 'remove') {
        if (!trigger) throw new Error('Provide a trigger to remove.');
        const removed = context.repos.telegram.deleteFilter(key, trigger.toLowerCase().replace(/^\//, ''));
        return message(removed ? `✅ Removed filter \`${trigger}\`.` : `Filter \`${trigger}\` was not found.`);
      }
      const filters = context.repos.telegram.listFilters(key);
      return message(filters.length ? `**Active filters**\n${filters.map(item => `• \`${item.trigger}\` → ${item.response}`).join('\n').slice(0, 1_850)}` : 'No filters are configured.', { ephemeral: true });
    } catch (error) {
      return message(error instanceof Error ? error.message : 'Could not update that filter.', { ephemeral: true });
    }
  }

  if (name === 'blocklist') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_MANAGE_MESSAGES)) {
      return message('You need Manage Messages to configure the blocklist.', { ephemeral: true });
    }
    const key = `dc:${guildId}`;
    const action = String(commandOption(command, 'action') || 'list');
    const pattern = String(commandOption(command, 'pattern') || '').trim().toLowerCase();
    try {
      if (action === 'add') return message(`✅ Added \`${addBlocklist(context.repos.telegram, key, pattern, String(user.id || ''), Math.floor(context.now()))}\` to the blocklist.`);
      if (action === 'remove') {
        if (!pattern) throw new Error('Provide a pattern to remove.');
        const removed = context.repos.telegram.deleteBlocklistPattern(key, pattern);
        return message(removed ? `✅ Removed \`${pattern}\` from the blocklist.` : `\`${pattern}\` was not in the blocklist.`);
      }
      const patterns = context.repos.telegram.listBlocklist(key);
      return message(patterns.length ? `**Blocklisted text**\n${patterns.map(value => `• \`${value}\``).join('\n').slice(0, 1_850)}` : 'The blocklist is empty.', { ephemeral: true });
    } catch (error) {
      return message(error instanceof Error ? error.message : 'Could not update the blocklist.', { ephemeral: true });
    }
  }

  if (name === 'setup') {
    if (!guildId || !hasPermission((interaction.member as DiscordObject | undefined)?.permissions, DISCORD_ADMINISTRATOR)) {
      return message('Only a server administrator can run setup.', { ephemeral: true });
    }
    const applicationId = context.config.DISCORD_CLIENT_ID || '';
    const interactionToken = String(interaction.token || '');
    void setupDiscordGuild(rest, guildId, applicationId).then(async created => {
      const content = created.length
        ? `✅ TinyFrens server setup complete. Created ${created.join(', ')}.`
        : '✅ TinyFrens server setup is already complete; nothing was duplicated.';
      await rest.patch(Routes.webhookMessage(applicationId, interactionToken, '@original'), { body: { content } });
    }).catch(async error => {
      void context.operationalAlerts.report('discord:setup', 'Discord server setup failed', error instanceof Error ? error.message : String(error));
      await rest.patch(Routes.webhookMessage(applicationId, interactionToken, '@original'), {
        body: { content: `Setup failed: ${error instanceof Error ? error.message : 'Discord rejected the action.'}` },
      }).catch(() => undefined);
    });
    return { type: 5, data: { flags: 64 } };
  }

  if (name === 'status') {
    const uptime = Math.max(0, Math.floor(context.now() - context.startTime));
    const gatewayHeartbeat = Number(context.repos.telegram.getIndexerState('discord_gateway_heartbeat') || 0);
    const gatewayRevision = context.repos.telegram.getIndexerState('discord_gateway_revision') || 'unknown';
    const gatewayOnline = gatewayHeartbeat > 0 && context.now() - gatewayHeartbeat <= 90;
    const revisionMatches = Boolean(context.config.APP_REVISION && gatewayRevision === context.config.APP_REVISION);
    return message([
      '✅ TinyFrens backend online',
      '✅ Discord interactions verified',
      `${gatewayOnline ? '✅' : '❌'} Discord Gateway ${gatewayOnline ? 'online' : 'not reporting'}`,
      `${revisionMatches ? '✅' : '⚠️'} Gateway revision ${gatewayRevision.slice(0, 7)}`,
      `Backend revision ${(context.config.APP_REVISION || 'unknown').slice(0, 7)}`,
      `Uptime: ${Math.floor(uptime / 60)}m`,
    ].join('\n'));
  }

  return message('TinyFrens is online. Use `/game` for the shared Scrap Run or `/setup` to build the server.', { ephemeral: true });
}

async function handleDiscordComponent(context: AppContext, interaction: DiscordObject): Promise<Record<string, unknown>> {
  const data = interaction.data as DiscordObject;
  const customId = String(data.custom_id || '');
  const guildId = String(interaction.guild_id || '');
  const channelId = String(interaction.channel_id || '');
  const user = interactionUser(interaction);
  if (!guildId || !channelId || !customId.startsWith('game:')) {
    return message('That action is no longer available.', { ephemeral: true });
  }
  if (customId === 'game:new') {
    const key = chatKey(guildId, channelId);
    const now = Math.floor(context.now());
    expireStaleScrapRun(context.db, key, now);
    const existing = getOpenScrapRun(context.db, key);
    const state = existing || startScrapRun(
      context.db, key, String(user.id || ''),
      String(user.global_name || user.username || 'Fren'), now, context.random()
    ).state;
    const card = renderDiscordScrap(state);
    return updateMessage(card.content, card.components);
  }
  const [, runId, action] = customId.split(':');
  const now = Math.floor(context.now());
  let linkedPetId = '';
  if (action === 'join') {
    try {
      linkedPetId = discordPet(context, user).id;
    } catch (error) {
      return message(error instanceof Error ? error.message : 'Link Discord to TinyFrens before joining.', { ephemeral: true });
    }
  }
  const result = action === 'join'
    ? joinScrapRun(
        context.db, runId, String(user.id || ''), linkedPetId,
        String(user.global_name || user.username || 'Fren'), now
      )
    : action === 'resolve'
      ? resolveScrapRun(
          context.db, runId, String(user.id || ''), now, context.random(),
          (petId, credits, scrapRunId) => context.economy.grant(petId, credits, 'discord-scrap', 'scrap-run', scrapRunId)
        )
      : { ok: false as const, reason: 'missing' as const };
  if (!result.ok) {
    const errors = {
      missing: 'That Scrap Run is no longer available.',
      closed: 'That Scrap Run is closed.',
      full: 'The crew is full.',
      'not-member': 'Join the crew before searching.',
    };
    return message(errors[result.reason], { ephemeral: true });
  }
  const card = renderDiscordScrap(result.state);
  return updateMessage(card.content, card.components);
}

export function registerDiscordRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/discord/token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const clientId = context.config.DISCORD_CLIENT_ID;
      const clientSecret = context.config.DISCORD_CLIENT_SECRET;
      if (!clientId || !clientSecret) return reply.status(503).send({ error: 'Discord app is not configured' });
      const body = (request.body || {}) as Record<string, unknown>;
      const code = String(body.code || '');
      if (!code) return reply.status(400).send({ error: 'Missing authorization code' });
      const [data, status] = await exchangeDiscordCode(code, clientId, clientSecret, context.config.DISCORD_REDIRECT_URI || '');
      if (status >= 400) return reply.status(status).send({ error: (data.error_description as string) || 'Discord token exchange failed' });
      return reply.status(200).send(data);
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message || 'Discord sign-in failed' });
    }
  });

  app.post('/api/discord/interactions', { config: { rawBody: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const publicKey = context.config.DISCORD_PUBLIC_KEY;
      if (!publicKey) return reply.status(503).send({ error: 'Discord app is not configured' });
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody || Buffer.from('');
      const signature = String(request.headers['x-signature-ed25519'] || '');
      const timestamp = String(request.headers['x-signature-timestamp'] || '');
      if (!verifyDiscordInteraction(signature, timestamp, rawBody, publicKey)) {
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.status(401).send('invalid request signature');
      }
      let interaction: DiscordObject;
      try {
        interaction = JSON.parse(rawBody.toString('utf-8')) as DiscordObject;
      } catch {
        return reply.status(400).send({ error: 'bad body' });
      }
      if (interaction.type === 1) return reply.status(200).send({ type: 1 });
      const token = context.config.DISCORD_BOT_TOKEN;
      if (!token) return reply.status(200).send(message('Discord bot actions are not configured yet.', { ephemeral: true }));
      const rest = createDiscordRest(token);
      if (interaction.type === 2) return reply.status(200).send(await handleDiscordCommand(context, rest, interaction));
      if (interaction.type === 3) return reply.status(200).send(await handleDiscordComponent(context, interaction));
      return reply.status(200).send(message('That Discord action is not supported.', { ephemeral: true }));
    } catch (error) {
      app.log.error({ err: error }, 'Discord interaction failed');
      void context.operationalAlerts.report('discord:interaction', 'Discord interaction failed', error instanceof Error ? error.message : String(error));
      return reply.status(200).send(message('TinyFrens hit an error while handling that action.', { ephemeral: true }));
    }
  });
}
