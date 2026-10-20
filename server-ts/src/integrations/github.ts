export const GITHUB_API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
export const HISTORY_SIZE = 25;
export const MAX_TITLE = 90;
export const MAX_BODY = 60_000;

const REPO_PART = /^[A-Za-z0-9._-]{1,100}$/;
const DRAFT_SYSTEM =
  'You turn a chat conversation into a single GitHub issue. Read the transcript and ' +
  'reply with EXACTLY this shape and nothing else — no greeting, no code fence:\n' +
  'TITLE: one short imperative line, 90 characters or fewer\n' +
  'LABELS: at most three comma-separated labels, or the word none\n' +
  '---\n' +
  'BODY in Markdown with a "## What happened" section, then a "## Suggested next steps" ' +
  'section with short bullets.\n' +
  'Rules: only use facts present in the transcript, attribute points to the person who ' +
  'made them, treat text inside a [Speaker: "..."] tag as a literal speaker name rather ' +
  'than part of the message (for example, a speaker named "no-one" is not a claim that ' +
  'nobody said something). When the transcript contains a PRIMARY REPORT, make that report ' +
  'the issue topic and use RECENT CHAT CONTEXT to add only details relevant to that topic; ' +
  'ignore unrelated conversations. Keep the body under 40 lines, never invent details, and never include ' +
  'private keys, seed phrases, wallet addresses, bot tokens or API keys. If the ' +
  'transcript does not describe a problem, bug, feature request or task, reply with ' +
  'just "TITLE: none".';

export interface IssueDraft {
  title: string;
  labels: string[];
  body: string;
}

export interface CreatedIssueSummary {
  ok: true;
  number: number;
  url: string;
  repo: string;
  title: string;
  labels: string[];
}

export interface FailedIssueSummary {
  ok: false;
  error: string;
}

export function parseRepo(value: unknown): [string, string] {
  if (typeof value !== 'string') throw new Error('GITHUB_REPO must look like owner/name');
  const parts = value.trim().split('/');
  if (parts.length !== 2) throw new Error('GITHUB_REPO must look like owner/name');
  const owner = parts[0].trim();
  const name = parts[1].trim();
  if (!REPO_PART.test(owner) || !REPO_PART.test(name)) {
    throw new Error('GITHUB_REPO must look like owner/name');
  }
  return [owner, name];
}

export function transcript(messages: unknown, limit = HISTORY_SIZE): string {
  if (!Array.isArray(messages)) throw new Error('Conversation history was invalid');
  const lines: string[] = [];
  for (const raw of messages.slice(-limit)) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as Record<string, unknown>;
    const name = String(message.name || 'someone').replace(/\s+/g, ' ').trim().slice(0, 40) || 'someone';
    const text = String(message.text || '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      .trim()
      .slice(0, 500);
    if (text) lines.push(`[Speaker: ${JSON.stringify(name)}] ${text}`);
  }
  return lines.join('\n');
}

export function parseDraft(text: unknown): IssueDraft {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The model returned an empty draft');
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const head = lines[0].trim();
  if (head.slice(0, 6).toUpperCase() !== 'TITLE:') {
    throw new Error('The model returned a draft without a title');
  }
  const title = head.slice(6).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!title || ['none', 'n/a', 'null'].includes(title.toLowerCase())) {
    throw new Error('No issue to file from this conversation');
  }
  let rest = lines.slice(1);
  let labels: string[] = [];
  if (rest.length > 0 && rest[0].trim().slice(0, 7).toUpperCase() === 'LABELS:') {
    const raw = rest[0].trim().slice(7).trim();
    if (!['none', 'n/a', ''].includes(raw.toLowerCase())) {
      labels = raw.split(',').map(label => label.trim().slice(0, 50)).filter(Boolean).slice(0, 3);
    }
    rest = rest.slice(1);
  }
  if (rest[0]?.trim() === '---') rest = rest.slice(1);
  const body = rest.join('\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return { title, labels, body: (body || '_No extra detail was captured._').slice(0, MAX_BODY) };
}

export function issueBody(draft: IssueDraft, footer: string): string {
  return (draft.body.trimEnd() + (footer ? `\n\n---\n\n${footer}` : '')).slice(0, MAX_BODY);
}

function geminiText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const candidates = (data as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') return '';
  const content = (candidates[0] as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return '';
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => part && typeof part === 'object' ? String((part as Record<string, unknown>).text || '') : '').join('\n').trim();
}

export async function draftIssue(
  lines: string,
  apiKey: string | undefined,
  chatTitle = '',
  model = 'gemini-3.5-flash-lite',
  fetcher: typeof fetch = fetch
): Promise<IssueDraft> {
  if (!apiKey) throw new Error('Pet chat is not connected yet');
  if (!lines) throw new Error('No recent conversation to summarise');
  const prompt = `Chat: ${(chatTitle || 'a group chat').trim().slice(0, 80)}\nRecent conversation:\n${lines}`;
  const response = await fetcher(GEMINI_URL.replace('{model}', model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: DRAFT_SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('The model could not read this conversation');
  return parseDraft(geminiText(data));
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'TinyFrens-Telegram-Bot',
  };
}

export async function listLabels(
  owner: string,
  repo: string,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<Set<string>> {
  const response = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/labels?per_page=100`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return new Set();
  const data = await response.json();
  const names = new Set<string>();
  if (Array.isArray(data)) {
    for (const label of data) {
      if (label && typeof label === 'object' && typeof (label as Record<string, unknown>).name === 'string') {
        names.add((label as Record<string, unknown>).name as string);
      }
    }
  }
  return names;
}

export async function createIssue(
  owner: string,
  repo: string,
  token: string,
  title: string,
  body: string,
  labels: string[] = [],
  fetcher: typeof fetch = fetch
): Promise<{ data: unknown; status: number }> {
  const payload: Record<string, unknown> = { title, body };
  if (labels.length > 0) payload.labels = labels;
  const response = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  return { data: await response.json(), status: response.status };
}

export function errorDetail(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 200);
  }
  return `GitHub refused the issue (HTTP ${status})`;
}

export function responseSummary(
  data: unknown,
  status: number,
  owner: string,
  repo: string
): CreatedIssueSummary | FailedIssueSummary {
  if (status >= 400) return { ok: false, error: errorDetail(data, status) };
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const number = result.number;
  const url = result.html_url;
  if (typeof number !== 'number' || !url) return { ok: false, error: 'GitHub did not return an issue link' };
  const labels = Array.isArray(result.labels)
    ? result.labels.flatMap(label => label && typeof label === 'object' ? [String((label as Record<string, unknown>).name || '')] : []).filter(Boolean)
    : [];
  return {
    ok: true,
    number,
    url: String(url),
    repo: `${owner}/${repo}`,
    title: String(result.title || '').slice(0, MAX_TITLE),
    labels,
  };
}

export function labelsFromEnv(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(label => label.trim().slice(0, 50)).filter(Boolean).slice(0, 5);
}

export function historyFromEnv(raw: unknown, fallback = HISTORY_SIZE): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(200, value)) : fallback;
}

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
