import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Config } from '../config.js';
import { GITHUB_API, GITHUB_API_VERSION } from './github.js';

interface CachedToken {
  token: string;
  expires: number;
}

export interface GitHubTokenProvider {
  token(owner: string, repo: string): Promise<string | undefined>;
}

export class GitHubApp {
  readonly cache = new Map<string, CachedToken>();
  private lock = Promise.resolve();

  constructor(
    readonly issuer: string,
    readonly keyPath: string,
    readonly installationId?: string,
    private readonly now: () => number = () => Date.now() / 1000,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async jwt(): Promise<string> {
    try {
      const privateKey = await readFile(this.keyPath);
      const stamp = Math.trunc(this.now());
      const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = encodeBase64Url(JSON.stringify({ iat: stamp - 60, exp: stamp + 540, iss: this.issuer }));
      const message = `${header}.${claims}`;
      const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url');
      return `${message}.${signature}`;
    } catch {
      throw new Error('GitHub App private key is missing or invalid');
    }
  }

  async token(owner: string, repo: string): Promise<string> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      let keyStat;
      try {
        keyStat = await stat(this.keyPath, { bigint: true });
      } catch {
        throw new Error('GitHub App private key is missing or invalid');
      }
      const cacheKey = `${owner}/${repo}:${keyStat.mtimeNs}:${keyStat.size}`;
      const cached = this.cache.get(cacheKey);
      if (cached && this.now() < cached.expires - 60) return cached.token;

      const jwt = await this.jwt();
      let installation: unknown = this.installationId;
      if (!installation) {
        const discovered = await this.request('GET', `/repos/${owner}/${repo}/installation`, jwt);
        installation = record(discovered).id;
      }
      const installationNumber = Number(installation);
      if (!Number.isInteger(installationNumber) || installationNumber <= 0) {
        throw new Error('GitHub App installation ID is invalid');
      }
      const response = await this.request(
        'POST',
        `/app/installations/${installationNumber}/access_tokens`,
        jwt,
        { repositories: [repo], permissions: { issues: 'write' } }
      );
      const data = record(response);
      const token = data.token;
      const expires = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) / 1000 : Number.NaN;
      if (typeof token !== 'string' || !token || !Number.isFinite(expires) || expires <= this.now() + 60) {
        throw new Error('GitHub App returned an invalid installation token');
      }
      this.cache.clear();
      this.cache.set(cacheKey, { token, expires });
      return token;
    } finally {
      release();
    }
  }

  private async request(
    method: string,
    path: string,
    jwt: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const response = await this.fetcher(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'TinyFrens-Telegram-Bot',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub App authentication failed (HTTP ${response.status})`);
    return response.json();
  }
}

export class GitHubAuth implements GitHubTokenProvider {
  private readonly app?: GitHubApp;
  private readonly partialAppConfiguration: boolean;

  constructor(private readonly config: Config, options?: { now?: () => number; fetcher?: typeof fetch }) {
    const settings = [config.GITHUB_APP_ID, config.GITHUB_APP_PRIVATE_KEY_PATH, config.GITHUB_APP_INSTALLATION_ID];
    this.partialAppConfiguration = settings.some(Boolean) && (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY_PATH);
    if (!this.partialAppConfiguration && config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY_PATH) {
      this.app = new GitHubApp(
        config.GITHUB_APP_ID,
        config.GITHUB_APP_PRIVATE_KEY_PATH,
        config.GITHUB_APP_INSTALLATION_ID,
        options?.now,
        options?.fetcher
      );
    }
  }

  async token(owner: string, repo: string): Promise<string | undefined> {
    if (this.partialAppConfiguration) {
      throw new Error('GitHub App needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH');
    }
    return this.app ? this.app.token(owner, repo) : this.config.GITHUB_TOKEN;
  }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
