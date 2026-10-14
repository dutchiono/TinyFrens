export const MAX_TITLE = 120;

export interface IssueEventDetails {
  kind: 'comment' | 'closed' | 'reopened';
  number: number;
  title: string;
  url: string;
  repo: string;
  who: string;
  text: string;
}

export function issueEvent(payload: unknown): IssueEventDetails | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const p = payload as Record<string, unknown>;
  const event = p.event;
  const action = p.action;
  const issue = p.issue;

  if (!issue || typeof issue !== 'object') {
    return null;
  }
  const issueObj = issue as Record<string, unknown>;
  const number = issueObj.number;
  if (typeof number !== 'number') {
    return null;
  }

  let kind: 'comment' | 'closed' | 'reopened';
  let text = '';

  if (event === 'issue_comment') {
    if (action !== 'created') {
      return null;
    }
    const comment = (p.comment && typeof p.comment === 'object') ? (p.comment as Record<string, unknown>) : {};
    text = String(comment.body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    kind = 'comment';
  } else if (event === 'issues') {
    if (action !== 'closed' && action !== 'reopened') {
      return null;
    }
    kind = action as 'closed' | 'reopened';
  } else {
    return null;
  }

  const repo = (p.repository && typeof p.repository === 'object') ? (p.repository as Record<string, unknown>) : {};
  const sender = (p.sender && typeof p.sender === 'object') ? (p.sender as Record<string, unknown>) : null;
  const who = sender ? String(sender.login || 'someone') : 'someone';

  return {
    kind,
    number,
    title: String(issueObj.title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE),
    url: String(issueObj.html_url || ''),
    repo: String(repo.full_name || ''),
    who: who.slice(0, 60),
    text,
  };
}

export function issueEventMessage(details: IssueEventDetails | null): string | null {
  if (!details) {
    return null;
  }
  let head = '#' + details.number;
  if (details.title) {
    head += ' ' + details.title;
  }
  let body = '';
  if (details.kind === 'comment') {
    body = '💬 ' + details.who + ' commented on issue ' + head;
    if (details.text) {
      body += ':\n' + details.text;
    }
  } else {
    body = (details.kind === 'closed' ? '✅ ' : '🔓 ') + 'Issue ' + head + ' was ' + details.kind;
  }
  if (details.url) {
    body += '\n' + details.url;
  }
  return body;
}

export function filterLabels(requested: unknown[] | undefined | null, available: Set<string>): string[] {
  if (!available || available.size === 0 || !Array.isArray(requested)) {
    return [];
  }
  const byLower = new Map<string, string>();
  for (const name of available) {
    byLower.set(name.toLowerCase(), name);
  }
  const kept: string[] = [];
  const seen = new Set<string>();

  for (const raw of requested) {
    if (typeof raw !== 'string') continue;
    const match = byLower.get(raw.trim().toLowerCase());
    if (match && !seen.has(match.toLowerCase())) {
      seen.add(match.toLowerCase());
      kept.push(match);
    }
  }
  return kept;
}
