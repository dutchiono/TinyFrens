import type { AppContext } from '../context.js';
import {
  createIssue,
  draftIssue,
  filterLabels,
  issueBody,
  labelsFromEnv,
  listLabels,
  parseRepo,
  responseSummary,
  transcript,
  type CreatedIssueSummary,
} from '../integrations/github.js';

export interface CommunityIssueMessage {
  name: string;
  text: string;
}

export interface CommunityIssueRequest {
  messages: CommunityIssueMessage[];
  description?: string;
  focus?: CommunityIssueMessage;
  chatTitle: string;
  linkTarget: string;
  footer: string;
}

export async function fileCommunityIssue(
  context: AppContext,
  request: CommunityIssueRequest,
  fetcher: typeof fetch = fetch
): Promise<CreatedIssueSummary> {
  if (!context.config.GITHUB_REPO) throw new Error('GitHub issue filing is not configured.');
  const [owner, repo] = parseRepo(context.config.GITHUB_REPO);
  const githubToken = await context.githubAuth.token(owner, repo);
  if (!githubToken) throw new Error('GitHub issue filing is not configured.');
  const focusedMessage = request.focus ? transcript([request.focus], 1) : '';
  const description = request.description?.trim() || '';
  const recentMessages = request.focus
    ? request.messages.filter(message =>
        message.name !== request.focus?.name || message.text !== request.focus?.text)
    : request.messages;
  const recentContext = transcript(recentMessages, context.config.TELEGRAM_ISSUE_HISTORY);
  const selectedReport = [focusedMessage, description].filter(Boolean).join('\n');
  const lines = focusedMessage
    ? [
        'PRIMARY REPORT — the /issue command explicitly replied to this message. This is the issue topic:',
        focusedMessage,
        description ? `Additional detail supplied with /issue: ${description}` : '',
        recentContext
          ? `RECENT CHAT CONTEXT — summarize only details relevant to the primary report:\n${recentContext}`
          : '',
      ].filter(Boolean).join('\n')
    : description
      ? `PRIMARY REPORT — the /issue command explicitly supplied this report. Draft the issue from this report only:\n${description}`
      : transcript(request.messages, context.config.TELEGRAM_ISSUE_HISTORY + 1);
  if (!lines) throw new Error('I have not seen enough conversation context to draft an issue yet.');
  const fallbackReport = selectedReport || lines;
  const fallbackTitleSource = request.focus?.text || description || lines;
  const fallback = {
    title: (`Report: ${fallbackTitleSource.replace(/\s+/g, ' ').slice(0, 80)}`).slice(0, 90),
    labels: [] as string[],
    body: `## What happened\n\n${fallbackReport}\n\n## Suggested next steps\n\n- Reproduce and investigate the reported behavior.`,
  };
  const apiKey = context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY;
  let draft = fallback;
  if (apiKey) {
    try {
      draft = await draftIssue(lines, apiKey, request.chatTitle, context.config.GEMINI_MODEL, fetcher);
    } catch (error) {
      console.warn('Community issue AI drafting failed; using verbatim report:', error instanceof Error ? error.message : 'unknown error');
    }
  }
  const available = await listLabels(owner, repo, githubToken, fetcher);
  const labels = filterLabels([...labelsFromEnv(context.config.GITHUB_ISSUE_LABELS), ...draft.labels], available);
  const created = await createIssue(owner, repo, githubToken, draft.title, issueBody(draft, request.footer), labels, fetcher);
  const result = responseSummary(created.data, created.status, owner, repo);
  if (!result.ok) throw new Error(result.error);
  context.repos.telegram.linkChatToIssue(result.repo, result.number, request.linkTarget);
  return result;
}
