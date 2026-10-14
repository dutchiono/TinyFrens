export const DISCORD_API = 'https://discord.com/api/v10';

export function channelRoomId(channelId: string): string {
  return 'dc:' + channelId;
}

export async function exchangeDiscordCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri = ''
): Promise<[Record<string, unknown>, number]> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
  });
  if (redirectUri) {
    form.set('redirect_uri', redirectUri);
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: form.toString(),
  });

  const status = response.status;
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // fallback empty
  }

  return [data, status];
}
