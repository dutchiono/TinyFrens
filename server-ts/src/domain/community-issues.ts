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
  chatTitle: string;
  linkTarget: string;
  footer: string;
}

export async function fileCommunityIssue(
  context: AppContext,
  request: CommunityIssueRequest,
  fetcher: typeof fetch = fetch
): Promise<CreatedIssueSummary> {
  const apiKey = context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('AI issue drafting is not configured.');
  if (!context.config.GITHUB_REPO) throw new Error('GitHub issue filing is not configured.');
  const [owner, repo] = parseRepo(context.config.GITHUB_REPO);
  const githubToken = await context.githubAuth.token(owner, repo);
  if (!githubToken) throw new Error('GitHub issue filing is not configured.');
  const lines = transcript(request.messages, context.config.TELEGRAM_ISSUE_HISTORY + 1);
  if (!lines) throw new Error('I have not seen enough conversation context to draft an issue yet.');
  const draft = await draftIssue(lines, apiKey, request.chatTitle, context.config.GEMINI_MODEL, fetcher);
  const available = await listLabels(owner, repo, githubToken, fetcher);
  const labels = filterLabels([...labelsFromEnv(context.config.GITHUB_ISSUE_LABELS), ...draft.labels], available);
  const created = await createIssue(owner, repo, githubToken, draft.title, issueBody(draft, request.footer), labels, fetcher);
  const result = responseSummary(created.data, created.status, owner, repo);
  if (!result.ok) throw new Error(result.error);
  context.repos.telegram.linkChatToIssue(result.repo, result.number, request.linkTarget);
  return result;
}
