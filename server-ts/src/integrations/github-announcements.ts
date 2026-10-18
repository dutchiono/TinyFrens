type Payload = Record<string, any>;

export function githubAnnouncement(event: string, p: Payload): string | null {
  const repo = String(p.repository?.full_name || '');
  const url = String(p.repository?.html_url || '');
  if (!repo || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) return null;
  const safe = (value: unknown, max = 140) => String(value || '').replace(/[@`<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (event === 'pull_request') {
    const pr = p.pull_request;
    if (!pr || !['opened', 'closed', 'reopened'].includes(p.action)) return null;
    const status = p.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : p.action;
    return `🔀 **PR #${pr.number} ${status}** — ${safe(pr.title)}\n${url}/pull/${pr.number}`;
  }
  if (event === 'workflow_run' && p.action === 'completed') {
    const run = p.workflow_run;
    if (!run || !['success', 'failure', 'cancelled'].includes(run.conclusion)) return null;
    const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '⚪';
    return `${icon} **${safe(run.name)}** — ${safe(run.conclusion)} (${safe(run.head_branch, 60)})\n${url}/actions/runs/${run.id}`;
  }
  if (event === 'release' && p.action === 'published') {
    return `🚀 **Release ${safe(p.release?.tag_name)} published**\n${url}/releases/tag/${encodeURIComponent(String(p.release?.tag_name || ''))}`;
  }
  if (event === 'deployment_status' && ['success', 'failure', 'error'].includes(p.deployment_status?.state)) {
    return `🚀 **Deployment ${safe(p.deployment_status.state)}** — ${safe(p.deployment?.environment)}\n${url}/deployments`;
  }
  return null;
}

export async function sendGithubDiscordUpdate(channelId: string, botToken: string, content: string): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Discord GitHub announcement failed (HTTP ${response.status})`);
}
