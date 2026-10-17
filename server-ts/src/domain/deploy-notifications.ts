import type { AppContext } from '../context.js';

export interface DeploymentNotificationResult {
  subscribers: number;
  sent: number;
  alreadyNotified: number;
}

interface CommitSummary {
  title: string;
  files: string[];
}

const AREA_LABELS: Array<[string, RegExp]> = [
  ['Website', /^(?:web|site|play|updates|broadcast)\/|^(?:index\.html|vercel\.json)$/i],
  ['Telegram', /telegram|tg_scrap|tg_fren/i],
  ['Discord', /discord/i],
  ['Backend', /^(?:server-ts|server)\//i],
];

async function fetchCommitSummary(
  context: AppContext,
  revision: string,
  fetcher: typeof fetch
): Promise<CommitSummary | null> {
  const [owner, repo] = (context.config.GITHUB_REPO || 'dutchiono/TinyFrens').split('/', 2);
  if (!owner || !repo) return null;
  let token = context.config.GITHUB_TOKEN;
  if (!token) {
    try {
      token = await context.githubAuth.token(owner, repo);
    } catch {
      // Public commit details still work without authentication.
    }
  }
  try {
    const response = await fetcher(`https://api.github.com/repos/${owner}/${repo}/commits/${revision}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TinyFrens-Deploy-Notifier',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status !== 200) return null;
    const body = await response.json() as Record<string, unknown>;
    const commit = (body.commit || {}) as Record<string, unknown>;
    const files = Array.isArray(body.files)
      ? body.files.map(value => String((value as Record<string, unknown>).filename || '')).filter(Boolean)
      : [];
    return {
      title: String(commit.message || '').split(/\r?\n/)[0].slice(0, 180),
      files,
    };
  } catch {
    return null;
  }
}

function renderDeploymentCard(revision: string, summary: CommitSummary | null): string {
  const areas = summary
    ? AREA_LABELS.filter(([, pattern]) => summary.files.some(file => pattern.test(file))).map(([label]) => label)
    : [];
  const files = summary?.files
    .filter(file => !/(?:^|\/)(?:test|tests)\//i.test(file))
    .slice(0, 5) ?? [];
  const lines = ['✅ TinyFrens update', '', `Revision: ${revision.slice(0, 7)}`];
  if (summary?.title) lines.push('', 'What changed', `• ${summary.title}`);
  if (areas.length > 0) lines.push(`• Systems: ${areas.join(', ')}`);
  if (files.length > 0) {
    lines.push('', 'Updated code');
    for (const file of files) lines.push(`• ${file}`);
  }
  lines.push(
    '',
    'Verified live',
    '• Website publish completed successfully',
    '',
    'https://tinyfrens.lol',
    `https://github.com/dutchiono/TinyFrens/commit/${revision}`
  );
  return lines.join('\n').slice(0, 3900);
}

function telegramMessageId(response: { data: Record<string, unknown> | null }): number | null {
  const result = response.data?.result as Record<string, unknown> | undefined;
  const value = Number(result?.message_id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function deliverDeploymentNotification(
  context: AppContext,
  revision: string,
  fetcher: typeof fetch = fetch
): Promise<DeploymentNotificationResult> {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid release revision');
  const token = context.config.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram bot is not configured');

  const chats = context.repos.telegram.listDeployNotificationChats();
  const summary = await fetchCommitSummary(context, revision, fetcher);
  const text = renderDeploymentCard(revision, summary);
  let sent = 0;
  let alreadyNotified = 0;
  let failures = 0;

  for (const chat of chats) {
    if (chat.last_revision === revision) {
      alreadyNotified += 1;
      continue;
    }
    try {
      let messageId = chat.message_id;
      if (messageId) {
        const edited = await context.telegramApi.call('editMessageText', {
          chat_id: chat.chat_id,
          message_id: messageId,
          text,
          disable_web_page_preview: true,
        }, token);
        if (edited.status !== 200 || edited.data?.ok !== true) messageId = null;
      }
      if (!messageId) {
        const response = await context.telegramApi.call('sendMessage', {
          chat_id: chat.chat_id,
          text,
          disable_web_page_preview: true,
          disable_notification: true,
        }, token);
        if (response.status !== 200 || response.data?.ok !== true) {
          throw new Error('Telegram rejected the message');
        }
        messageId = telegramMessageId(response);
        if (!messageId) throw new Error('Telegram omitted the deployment card message ID');
        if (chat.chat_id.startsWith('-')) {
          try {
            await context.telegramApi.call('pinChatMessage', {
              chat_id: chat.chat_id,
              message_id: messageId,
              disable_notification: true,
            }, token);
          } catch {
            // A missing pin permission must not cause duplicate update cards on retry.
          }
        }
      }
      context.repos.telegram.markDeployNotificationSent(
        chat.chat_id,
        revision,
        messageId,
        Math.floor(context.now())
      );
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
