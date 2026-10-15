import { randomBytes, randomInt } from 'node:crypto';
import { TelegramRepository, TgChallengeRow } from '../db/repositories/telegram.js';
import { TelegramBotApi } from '../integrations/telegram-api.js';
import {
  matchesBlocklistPattern,
  matchesTrigger,
  parseBanCommand,
  parseBlocklistCommand,
  parseFilterCommand,
} from './telegram-grammar.js';
import { isIssueCommand } from '../integrations/telegram.js';

type TelegramObject = Record<string, unknown>;

function escapeHtml(value: unknown): string {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function userMention(user: TelegramObject): string {
  const username = String(user.username || '').replace(/^@/, '');
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) return `@${username}`;
  const id = String(user.id || '');
  const name = escapeHtml(user.first_name || user.last_name || 'This user').slice(0, 80);
  return /^\d+$/.test(id) ? `<a href="tg://user?id=${id}">${name}</a>` : name;
}

export interface CreatedChallenge extends TgChallengeRow {
  left: number;
  right: number;
  options: number[];
}

export interface TelegramModerationOptions {
  enabled: boolean;
  timeout: number;
  botUsername?: string;
  token?: string;
  now?: () => number;
  randomInteger?: (maximum: number) => number;
  tokenFactory?: () => string;
}

export function addFilter(
  repo: TelegramRepository,
  chatId: unknown,
  triggerValue: unknown,
  responseValue: unknown,
  createdBy = '',
  now = Math.floor(Date.now() / 1000)
): string {
  const trigger = String(triggerValue || '').trim().toLowerCase().replace(/^\//, '');
  if (!trigger || trigger.length > 64) throw new Error('Trigger must be 1 to 64 characters without spaces');
  if (trigger.includes(' ')) throw new Error('Trigger cannot contain spaces');
  const response = String(responseValue || '').trim();
  if (!response || response.length > 2000) throw new Error('Filter response must be between 1 and 2000 characters');
  repo.setFilter(String(chatId), trigger, response, String(createdBy), now);
  return trigger;
}

export function matchFilter(repo: TelegramRepository, chatId: unknown, text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const filters = repo.listFilters(String(chatId)).sort((a, b) => b.trigger.length - a.trigger.length);
  return filters.find(filter => matchesTrigger(text, filter.trigger))?.response ?? null;
}

export function addBlocklist(
  repo: TelegramRepository,
  chatId: unknown,
  patternValue: unknown,
  createdBy = '',
  now = Math.floor(Date.now() / 1000)
): string {
  const pattern = String(patternValue || '').trim().toLowerCase();
  if (!pattern || pattern.length > 128) throw new Error('Blocklist pattern must be between 1 and 128 characters');
  repo.addBlocklistPattern(String(chatId), pattern, String(createdBy), now);
  return pattern;
}

export function matchBlocklist(repo: TelegramRepository, chatId: unknown, text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  return repo.listBlocklist(String(chatId)).find(pattern => matchesBlocklistPattern(text, pattern)) ?? null;
}

export function recordStrike(
  repo: TelegramRepository,
  chatId: unknown,
  userId: unknown,
  violation = '',
  now = Math.floor(Date.now() / 1000)
): number {
  const current = repo.getStrikes(String(chatId), String(userId)).strikes;
  const count = current + 1;
  repo.recordStrike(String(chatId), String(userId), count, String(violation).slice(0, 100), now);
  return count;
}

export async function isChatAdmin(
  api: TelegramBotApi,
  chat: unknown,
  sender: unknown,
  token: string,
  message?: unknown
): Promise<boolean> {
  if (!chat || typeof chat !== 'object') return false;
  const chatObject = chat as TelegramObject;
  if (chatObject.type !== 'group' && chatObject.type !== 'supergroup') return false;
  if (chatObject.id === null || chatObject.id === undefined) return false;

  if (message && typeof message === 'object') {
    const senderChat = ((message as TelegramObject).sender_chat || {}) as TelegramObject;
    if (senderChat.id === chatObject.id) return true;
  }

  const senderObject = sender && typeof sender === 'object' ? sender as TelegramObject : {};
  if (!senderObject.id) return false;
  try {
    const { data, status } = await api.call('getChatMember', {
      chat_id: chatObject.id,
      user_id: senderObject.id,
    }, token);
    const result = data?.result as TelegramObject | undefined;
    return status === 200 && data?.ok === true && (result?.status === 'creator' || result?.status === 'administrator');
  } catch {
    return false;
  }
}

function permissions(allowed: boolean): Record<string, boolean> {
  return Object.fromEntries([
    'can_send_messages', 'can_send_audios', 'can_send_documents', 'can_send_photos',
    'can_send_videos', 'can_send_video_notes', 'can_send_voice_notes', 'can_send_polls',
    'can_send_other_messages', 'can_add_web_page_previews', 'can_invite_users',
  ].map(key => [key, allowed]));
}

export class TelegramModeration {
  private timers = new Map<string, NodeJS.Timeout>();
  private now: () => number;
  private randomInteger: (maximum: number) => number;
  private tokenFactory: () => string;

  constructor(
    private repo: TelegramRepository,
    private api: TelegramBotApi,
    private options: TelegramModerationOptions
  ) {
    this.now = options.now ?? (() => Date.now() / 1000);
    this.randomInteger = options.randomInteger ?? randomInt;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(9).toString('base64url'));
  }

  start(): void {
    if (!this.options.enabled || !this.options.token) return;
    for (const challenge of this.repo.pendingChallenges()) this.schedule(challenge);
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  createChallenge(chatId: unknown, userId: unknown): CreatedChallenge {
    const current = Math.floor(this.now());
    const left = this.randomInteger(8) + 2;
    const right = this.randomInteger(8) + 2;
    const answer = left + right;
    const choices = new Set<number>([answer]);
    while (choices.size < 4) choices.add(Math.max(1, answer + this.randomInteger(9) - 4));
    const options = [...choices];
    for (let index = options.length - 1; index > 0; index -= 1) {
      const swap = this.randomInteger(index + 1);
      [options[index], options[swap]] = [options[swap], options[index]];
    }
    const challenge: CreatedChallenge = {
      chat_id: String(chatId),
      user_id: String(userId),
      token: this.tokenFactory(),
      answer,
      attempts: 0,
      expires: current + Math.max(60, Math.min(600, Math.trunc(this.options.timeout))),
      message_id: null,
      left,
      right,
      options,
    };
    this.repo.saveChallenge(challenge);
    return challenge;
  }

  async handleUpdate(update: unknown): Promise<boolean> {
    if (!this.options.enabled || !this.options.token || !update || typeof update !== 'object') return false;
    const object = update as TelegramObject;
    const callback = object.callback_query;
    if (callback && typeof callback === 'object') {
      const handled = await this.handleCallback(callback as TelegramObject);
      if (handled) return true;
    }
    const message = object.message;
    if (!message || typeof message !== 'object') return false;
    return this.handleNewMembers(message as TelegramObject);
  }

  async handleManagement(message: TelegramObject, chat: TelegramObject | null): Promise<boolean> {
    if (!this.options.token) return false;
    const text = String(message.text || '');
    const sender = message.from && typeof message.from === 'object' ? message.from as TelegramObject : {};
    const chatId = chat?.id;
    const isGroup = chat?.type === 'group' || chat?.type === 'supergroup';

    const botReview = text.match(/^\/(unbot|bot)(?:@\w+)?\s*$/i);
    if (botReview && chatId !== null && chatId !== undefined) {
      if (!isGroup) {
        await this.sendMessage(chatId, 'This command can only be used in group chats.');
        return true;
      }
      if (!await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        await this.sendMessage(chatId, 'Only chat administrators can mark suspected bots.');
        return true;
      }
      const replyMessage = message.reply_to_message;
      if (!replyMessage || typeof replyMessage !== 'object') {
        await this.sendMessage(chatId, `Reply to a user's message with /${botReview[1].toLowerCase()}.`);
        return true;
      }
      const target = ((replyMessage as TelegramObject).from || {}) as TelegramObject;
      const targetId = String(target.id || '');
      if (!/^\d+$/.test(targetId)) {
        await this.sendMessage(chatId, 'Could not identify the user in that message.');
        return true;
      }
      const mention = userMention(target);
      const commandMessageId = Number(message.message_id || 0);
      if (botReview[1].toLowerCase() === 'bot') {
        this.repo.markSuspectedBot({
          chat_id: String(chatId),
          user_id: targetId,
          username: String(target.username || '').replace(/^@/, '').slice(0, 32),
          display_name: String(target.first_name || target.last_name || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80),
          flagged_by: String(sender.id || ''),
          source_message_id: typeof (replyMessage as TelegramObject).message_id === 'number'
            ? (replyMessage as TelegramObject).message_id as number
            : null,
          flagged_at: Math.floor(this.now()),
        });
        await this.strictCall('sendMessage', {
          chat_id: chatId,
          text: `⚠️ ${mention} was marked as a suspected bot for admin review.`,
          parse_mode: 'HTML',
          reply_to_message_id: (replyMessage as TelegramObject).message_id,
        });
      } else {
        const removed = this.repo.clearSuspectedBot(String(chatId), targetId);
        await this.strictCall('sendMessage', {
          chat_id: chatId,
          text: removed
            ? `✅ Removed the suspected-bot label from ${mention}.`
            : `${mention} was not marked as a suspected bot.`,
          parse_mode: 'HTML',
          reply_to_message_id: (replyMessage as TelegramObject).message_id,
        });
      }
      if (commandMessageId > 0) {
        await this.api.call('deleteMessage', {
          chat_id: chatId,
          message_id: commandMessageId,
        }, this.options.token).catch(() => undefined);
      }
      return true;
    }

    const warning = text.match(/^\/(unwarn|warn)(?:@\w+)?(?:\s+([\s\S]+))?\s*$/i);
    if (warning && chatId !== null && chatId !== undefined) {
      if (!isGroup) {
        await this.sendMessage(chatId, 'This command can only be used in group chats.');
        return true;
      }
      if (!await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        await this.sendMessage(chatId, 'Only chat administrators can warn members.');
        return true;
      }
      const replyMessage = message.reply_to_message;
      if (!replyMessage || typeof replyMessage !== 'object') {
        await this.sendMessage(chatId, `Reply to a user's message with /${warning[1].toLowerCase()}.`);
        return true;
      }
      const target = ((replyMessage as TelegramObject).from || {}) as TelegramObject;
      const targetId = String(target.id || '');
      if (!/^\d+$/.test(targetId)) {
        await this.sendMessage(chatId, 'Could not identify the user in that message.');
        return true;
      }
      if (target.is_bot === true) {
        await this.sendMessage(chatId, 'This warning ladder is for group members, not bots.');
        return true;
      }
      if (await isChatAdmin(this.api, chat, target, this.options.token)) {
        await this.sendMessage(chatId, 'Cannot warn a chat administrator.');
        return true;
      }

      const mention = userMention(target);
      const commandMessageId = Number(message.message_id || 0);
      const replyMessageId = (replyMessage as TelegramObject).message_id;
      if (warning[1].toLowerCase() === 'unwarn') {
        const removed = this.repo.clearModerationWarnings(String(chatId), targetId);
        await this.strictCall('sendMessage', {
          chat_id: chatId,
          text: removed ? `✅ Cleared all warnings for ${mention}.` : `${mention} has no active warnings.`,
          parse_mode: 'HTML',
          reply_to_message_id: replyMessageId,
        });
      } else {
        const previous = this.repo.getModerationWarnings(String(chatId), targetId);
        if (commandMessageId > 0 && previous?.source_message_id === commandMessageId) return true;
        if (typeof replyMessageId === 'number' && replyMessageId > 0) {
          await this.api.call('deleteMessage', {
            chat_id: chatId,
            message_id: replyMessageId,
          }, this.options.token).catch(() => undefined);
        }
        const count = Math.min(3, (previous?.warnings ?? 0) + 1);
        const now = Math.floor(this.now());
        const reason = String(warning[2] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        let mutedUntil: number | null = previous?.muted_until ?? null;
        let notice: string;

        if (count === 1) {
          notice = `⚠️ ${mention} warning 1/3. Please keep it civil.${reason ? `\nReason: ${escapeHtml(reason)}` : ''}`;
        } else if (count === 2) {
          mutedUntil = now + 10 * 60;
          await this.strictCall('restrictChatMember', {
            chat_id: chatId,
            user_id: Number(targetId),
            permissions: permissions(false),
            until_date: mutedUntil,
          });
          notice = `🔇 ${mention} warning 2/3. Muted for 10 minutes.${reason ? `\nReason: ${escapeHtml(reason)}` : ''}`;
        } else {
          await this.strictCall('banChatMember', {
            chat_id: chatId,
            user_id: Number(targetId),
            revoke_messages: false,
          });
          notice = `🚫 ${mention} warning 3/3. Banned from the group.${reason ? `\nReason: ${escapeHtml(reason)}` : ''}`;
        }

        await this.strictCall('sendMessage', {
          chat_id: chatId,
          text: notice,
          parse_mode: 'HTML',
          reply_to_message_id: replyMessageId,
        });
        this.repo.recordModerationWarning({
          chat_id: String(chatId),
          user_id: targetId,
          warnings: count,
          last_reason: reason,
          warned_by: String(sender.id || ''),
          muted_until: mutedUntil,
          source_message_id: commandMessageId > 0 ? commandMessageId : null,
          updated_at: now,
        });
      }
      if (commandMessageId > 0) {
        await this.api.call('deleteMessage', {
          chat_id: chatId,
          message_id: commandMessageId,
        }, this.options.token).catch(() => undefined);
      }
      return true;
    }

    const ban = parseBanCommand(text);
    if (ban.isBan && chatId !== null && chatId !== undefined) {
      if (!isGroup) {
        await this.sendMessage(chatId, 'This command can only be used in group chats.');
        return true;
      }
      if (!await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        await this.sendMessage(chatId, 'Only chat administrators can use this command.');
        return true;
      }
      const replyMessage = message.reply_to_message;
      if (!replyMessage || typeof replyMessage !== 'object') {
        await this.sendMessage(chatId, "Reply to a user's message with /ban or /aiban to ban them.");
        return true;
      }
      const target = ((replyMessage as TelegramObject).from || {}) as TelegramObject;
      const targetId = target.id;
      if (!targetId) {
        await this.sendMessage(chatId, 'Could not identify the user to ban.');
        return true;
      }
      if (target.is_bot === true) {
        await this.sendMessage(chatId, 'Cannot ban a bot with this command.');
        return true;
      }
      if (await isChatAdmin(this.api, chat, target, this.options.token)) {
        await this.sendMessage(chatId, 'Cannot ban a chat administrator.');
        return true;
      }
      const response = await this.api.call('banChatMember', { chat_id: chatId, user_id: targetId }, this.options.token);
      const targetName = target.username ? `@${target.username}` : String(target.first_name || `User ${targetId}`);
      if (response.status === 200 && response.data?.ok === true) {
        await this.sendMessage(chatId, `🚫 Banned ${targetName}.${ban.reason ? ` Reason: ${ban.reason}` : ''}`);
      } else {
        await this.sendMessage(chatId, `Could not ban ${targetName}: ${String(response.data?.description || 'Permission denied')}`);
      }
      return true;
    }

    const blocklist = parseBlocklistCommand(text);
    if (blocklist && chatId !== null && chatId !== undefined) {
      if (!isGroup) {
        await this.sendMessage(chatId, 'This command can only be used in group chats.');
        return true;
      }
      if (!await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        await this.sendMessage(chatId, 'Only chat administrators can configure the blocklist.');
        return true;
      }
      if (blocklist.type === 'add') {
        try {
          const pattern = addBlocklist(
            this.repo, chatId, blocklist.pattern, String(sender.id || ''), Math.floor(this.now())
          );
          await this.sendMessage(chatId, `Added '${pattern}' to the blocklist.`);
        } catch (error) {
          await this.sendMessage(chatId, (error as Error).message);
        }
      } else if (blocklist.type === 'remove') {
        const removed = this.repo.deleteBlocklistPattern(String(chatId), blocklist.pattern);
        await this.sendMessage(
          chatId,
          removed ? `Removed '${blocklist.pattern}' from the blocklist.` : `'${blocklist.pattern}' was not in the blocklist.`
        );
      } else {
        const patterns = this.repo.listBlocklist(String(chatId));
        await this.sendMessage(
          chatId,
          patterns.length ? `🚫 Blocklisted patterns:\n${patterns.map(pattern => `• ${pattern}`).join('\n')}` : 'The blocklist is currently empty.'
        );
      }
      return true;
    }

    const filter = parseFilterCommand(text);
    if (filter && chatId !== null && chatId !== undefined) {
      if (!isGroup) {
        await this.sendMessage(chatId, 'This command can only be used in group chats.');
        return true;
      }
      if (!await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        await this.sendMessage(chatId, 'Only chat administrators can configure filters.');
        return true;
      }
      if (filter.type === 'set') {
        try {
          const trigger = addFilter(
            this.repo, chatId, filter.trigger, filter.response, String(sender.id || ''), Math.floor(this.now())
          );
          await this.sendMessage(chatId, `Saved filter for '${trigger}'. Saying '${trigger}' or '/${trigger}' will reply with that message.`);
        } catch (error) {
          await this.sendMessage(chatId, (error as Error).message);
        }
      } else if (filter.type === 'remove') {
        const removed = this.repo.deleteFilter(String(chatId), filter.trigger);
        await this.sendMessage(
          chatId,
          removed ? `Removed filter for '${filter.trigger}'.` : `Filter '${filter.trigger}' was not found.`
        );
      } else {
        const filters = this.repo.listFilters(String(chatId));
        await this.sendMessage(
          chatId,
          filters.length
            ? `Active filters:\n${filters.map(item => `• /${item.trigger} → ${item.response}`).join('\n')}`
            : 'No filters have been set yet. Use /filter <trigger> <response> to add one.'
        );
      }
      return true;
    }
    return false;
  }

  async handleContent(message: TelegramObject, chat: TelegramObject | null): Promise<boolean> {
    if (!this.options.token) return false;
    const text = String(message.text || '');
    if (!text.trim() || chat?.id === null || chat?.id === undefined) return false;
    const chatId = chat.id;
    const sender = message.from && typeof message.from === 'object' ? message.from as TelegramObject : {};
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    if (isGroup && sender.is_bot !== true) {
      const violation = matchBlocklist(this.repo, chatId, text);
      if (violation && !await isChatAdmin(this.api, chat, sender, this.options.token, message)) {
        if (message.message_id) {
          await this.api.call('deleteMessage', {
            chat_id: chatId,
            message_id: message.message_id,
          }, this.options.token).catch(() => undefined);
        }
        const userId = sender.id;
        const strikes = this.repo.getStrikes(String(chatId), String(userId)).strikes;
        const targetName = sender.username ? `@${sender.username}` : String(sender.first_name || 'User');
        recordStrike(this.repo, chatId, userId, violation, Math.floor(this.now()));
        if (strikes === 0) {
          await this.sendMessage(
            chatId,
            `⚠️ ${targetName}, your message was removed for containing blocklisted content. Warning (1/2) — doing it again will result in a ban.`
          );
        } else {
          await this.api.call('banChatMember', { chat_id: chatId, user_id: userId }, this.options.token).catch(() => undefined);
          await this.sendMessage(chatId, `🚫 ${targetName} has been banned for repeated blocklist violations.`);
        }
        return true;
      }
    }

    if (!this.reservedMessage(text)) {
      const response = matchFilter(this.repo, chatId, text);
      if (response) {
        const payload: Record<string, unknown> = { chat_id: chatId, text: response };
        if (message.message_id) payload.reply_to_message_id = message.message_id;
        await this.strictCall('sendMessage', payload);
        return true;
      }
    }
    return false;
  }

  private async strictCall(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const { data, status } = await this.api.call(method, payload, this.options.token!);
    if (status >= 400 || !data || data.ok !== true) {
      throw new Error(String(data?.description || 'Telegram rejected the request'));
    }
    return data.result;
  }

  private async sendMessage(chatId: unknown, text: string): Promise<void> {
    await this.strictCall('sendMessage', { chat_id: chatId, text });
  }

  private reservedMessage(text: string): boolean {
    return text.startsWith('/start') || text.startsWith('/show') || text.startsWith('/link') ||
      isIssueCommand(text) || /^\/help(?:@\w+)?\s*$/i.test(text) ||
      /^\/(?:bot|unbot|warn|unwarn|game|pet|play|scrap|progress|github|work|status|admin|server|triage)(?:@\w+)?(?:\s+.*)?$/i.test(text);
  }

  private schedule(challenge: TgChallengeRow): void {
    if (!this.options.token) return;
    const existing = this.timers.get(challenge.token);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, Math.trunc(challenge.expires) - Math.trunc(this.now())) * 1000;
    const timer = setTimeout(() => {
      this.timers.delete(challenge.token);
      void this.removeUnverified(challenge, true).catch(() => undefined);
    }, delay);
    this.timers.set(challenge.token, timer);
  }

  private cancel(token: string): void {
    const timer = this.timers.get(token);
    if (timer) clearTimeout(timer);
    this.timers.delete(token);
  }

  private async removeUnverified(challenge: TgChallengeRow, notify: boolean): Promise<void> {
    const current = this.repo.getChallengeByToken(challenge.token);
    if (!current) return;
    try {
      await this.strictCall('banChatMember', {
        chat_id: current.chat_id,
        user_id: current.user_id,
        revoke_messages: true,
      });
      await this.strictCall('unbanChatMember', {
        chat_id: current.chat_id,
        user_id: current.user_id,
        only_if_banned: true,
      });
      if (current.message_id) {
        await this.strictCall('deleteMessage', {
          chat_id: current.chat_id,
          message_id: current.message_id,
        }).catch(() => undefined);
      }
      if (notify) {
        await this.strictCall('sendMessage', {
          chat_id: current.chat_id,
          text: 'An unverified newcomer was removed. They can rejoin and try again.',
        });
      }
    } finally {
      this.cancel(current.token);
      this.repo.deleteChallengeByToken(current.token);
    }
  }

  private async handleCallback(callback: TelegramObject): Promise<boolean> {
    const match = String(callback.data || '').match(/^tfverify:([A-Za-z0-9_-]{8,24}):([0-9]+)$/);
    if (!match) return false;
    const challenge = this.repo.getChallengeByToken(match[1]);
    const callbackId = callback.id;
    if (!challenge || challenge.expires <= Math.floor(this.now())) {
      await this.strictCall('answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'This challenge expired. Rejoin to try again.',
        show_alert: true,
      });
      return true;
    }
    const sender = callback.from && typeof callback.from === 'object' ? callback.from as TelegramObject : {};
    if (String(sender.id || '') !== challenge.user_id) {
      await this.strictCall('answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'This challenge belongs to the newcomer.',
        show_alert: true,
      });
      return true;
    }
    if (Number(match[2]) === challenge.answer) {
      await this.strictCall('restrictChatMember', {
        chat_id: challenge.chat_id,
        user_id: challenge.user_id,
        permissions: permissions(true),
        use_independent_chat_permissions: true,
      });
      this.cancel(challenge.token);
      this.repo.deleteChallengeByToken(challenge.token);
      await this.strictCall('answerCallbackQuery', { callback_query_id: callbackId, text: 'Verified — welcome!' });
      if (challenge.message_id) {
        await this.strictCall('deleteMessage', {
          chat_id: challenge.chat_id,
          message_id: challenge.message_id,
        }).catch(() => undefined);
      }
      const name = String(sender.first_name || 'Fren').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 40);
      await this.strictCall('sendMessage', {
        chat_id: challenge.chat_id,
        text: `✅ ${name} verified. Welcome to TinyFrens!`,
      });
      return true;
    }
    const attempts = this.repo.recordChallengeFailure(challenge.token);
    await this.strictCall('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: `Not quite.${attempts < 3 ? ' Try again.' : ' Rejoin to try again.'}`,
      show_alert: true,
    });
    if (attempts >= 3) await this.removeUnverified(challenge, true);
    return true;
  }

  private async handleNewMembers(message: TelegramObject): Promise<boolean> {
    const members = message.new_chat_members;
    const chat = message.chat;
    if (!Array.isArray(members) || !chat || typeof chat !== 'object') return false;
    const chatObject = chat as TelegramObject;
    if (chatObject.type !== 'group' && chatObject.type !== 'supergroup') return false;
    for (const value of members) {
      if (!value || typeof value !== 'object') continue;
      const member = value as TelegramObject;
      if (member.id === null || member.id === undefined) continue;
      const username = String(member.username || '').toLowerCase();
      const botUsername = String(this.options.botUsername || '').toLowerCase().replace(/^@/, '');
      if (username === 'tinyfrensbot' || (botUsername && username === botUsername)) continue;
      if (member.is_bot === true) {
        await this.strictCall('banChatMember', {
          chat_id: chatObject.id,
          user_id: member.id,
          revoke_messages: true,
        }).then(() => this.strictCall('sendMessage', {
          chat_id: chatObject.id,
          text: '🛡️ Removed a newly added bot.',
        })).catch(() => undefined);
        continue;
      }
      let restricted = false;
      let challenge: CreatedChallenge | null = null;
      try {
        const status = await this.strictCall('getChatMember', {
          chat_id: chatObject.id,
          user_id: member.id,
        }) as TelegramObject;
        if (status?.status === 'creator' || status?.status === 'administrator') continue;
        await this.strictCall('restrictChatMember', {
          chat_id: chatObject.id,
          user_id: member.id,
          permissions: permissions(false),
          use_independent_chat_permissions: true,
        });
        restricted = true;
        challenge = this.createChallenge(chatObject.id, member.id);
        const keyboard = {
          inline_keyboard: [challenge.options.slice(0, 2), challenge.options.slice(2)].map(row =>
            row.map(answer => ({ text: String(answer), callback_data: `tfverify:${challenge!.token}:${answer}` }))
          ),
        };
        const name = String(member.first_name || 'New fren').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 40);
        const result = await this.strictCall('sendMessage', {
          chat_id: chatObject.id,
          text: `🛡️ ${name}, prove you are human: what is ${challenge.left} + ${challenge.right}? You have ${Math.floor(Math.max(60, Math.min(600, this.options.timeout)) / 60)} minutes and 3 attempts.`,
          reply_markup: keyboard,
        }) as TelegramObject;
        this.repo.setChallengeMessage(challenge.token, typeof result?.message_id === 'number' ? result.message_id : null);
        this.schedule(challenge);
      } catch (error) {
        if (challenge) this.repo.deleteChallengeByToken(challenge.token);
        if (restricted) {
          await this.strictCall('restrictChatMember', {
            chat_id: chatObject.id,
            user_id: member.id,
            permissions: permissions(true),
            use_independent_chat_permissions: true,
          }).catch(() => undefined);
        }
        await this.api.call('sendMessage', {
          chat_id: chatObject.id,
          text: `⚠️ I could not protect this join. Give TinyFrensBot permission to restrict and remove members. (${(error as Error).message})`,
        }, this.options.token!).catch(() => undefined);
      }
    }
    return true;
  }
}
