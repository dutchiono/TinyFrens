import type { Config } from '../config.js';
import type { TelegramBotApi } from '../integrations/telegram-api.js';

export interface OperationalAlertSink {
  report(key: string, title: string, detail?: string): Promise<boolean>;
}

function safeText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? 'Unknown failure');
  return text
    .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_KEY]')
    .replace(/ghp_[0-9A-Za-z]{36}/g, '[REDACTED_TOKEN]')
    .replace(/github_pat_[0-9A-Za-z_]{82}/g, '[REDACTED_TOKEN]')
    .slice(0, 1_000);
}

export class TelegramOperationalAlerts implements OperationalAlertSink {
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly telegramApi: () => TelegramBotApi,
    private readonly now: () => number
  ) {}

  async report(key: string, title: string, detail?: string): Promise<boolean> {
    const token = this.config.TELEGRAM_BOT_TOKEN;
    const ownerId = this.config.TELEGRAM_DEPLOY_OWNER_ID;
    if (!token || !ownerId) return false;

    const now = Math.floor(this.now());
    const lastAttempt = this.attempts.get(key) || 0;
    if (now - lastAttempt < 15 * 60) return false;
    this.attempts.set(key, now);

    try {
      const lines = [`🚨 TinyFrens failure`, '', safeText(title)];
      if (detail) lines.push('', safeText(detail));
      if (this.config.APP_REVISION) lines.push('', `Revision: ${this.config.APP_REVISION.slice(0, 7)}`);
      const response = await this.telegramApi().call('sendMessage', {
        chat_id: ownerId,
        text: lines.join('\n'),
      }, token);
      const sent = response.status < 400 && response.data?.ok === true;
      if (!sent) this.attempts.delete(key);
      return sent;
    } catch {
      this.attempts.delete(key);
      return false;
    }
  }
}
