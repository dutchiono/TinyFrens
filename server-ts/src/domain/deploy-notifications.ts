import type { AppContext } from '../context.js';

export interface DeploymentNotificationResult {
  subscribers: number;
  sent: number;
  alreadyNotified: number;
}

export async function deliverDeploymentNotification(
  context: AppContext,
  revision: string
): Promise<DeploymentNotificationResult> {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid release revision');
  const token = context.config.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram bot is not configured');

  const chats = context.repos.telegram.listDeployNotificationChats();
  let sent = 0;
  let alreadyNotified = 0;
  let failures = 0;
  const text = [
    '✅ TinyFrens website is live',
    '',
    `Revision: ${revision.slice(0, 7)}`,
    'https://tinyfrens.lol',
    `https://github.com/dutchiono/TinyFrens/commit/${revision}`,
  ].join('\n');

  for (const chat of chats) {
    if (chat.last_revision === revision) {
      alreadyNotified += 1;
      continue;
    }
    try {
      const response = await context.telegramApi.call('sendMessage', {
        chat_id: chat.chat_id,
        text,
        disable_web_page_preview: true,
      }, token);
      if (response.status !== 200 || response.data?.ok !== true) {
        throw new Error('Telegram rejected the message');
      }
      context.repos.telegram.markDeployNotificationSent(chat.chat_id, revision, Math.floor(context.now()));
      sent += 1;
    } catch {
      failures += 1;
    }
  }

  if (failures > 0) {
    throw new Error(`Deployment notification failed for ${failures} subscribed chat(s)`);
  }
  return { subscribers: chats.length, sent, alreadyNotified };
}
