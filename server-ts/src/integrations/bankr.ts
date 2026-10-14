export class BankrVerificationUnavailableError extends Error {
  constructor(message = 'Bankr X verification unavailable. Retry the connection.') {
    super(message);
    this.name = 'BankrVerificationUnavailableError';
  }
}

export class BankrHandleMismatchError extends Error {
  constructor(message = 'Bankr does not link this X handle to the signing wallet') {
    super(message);
    this.name = 'BankrHandleMismatchError';
  }
}

export async function verifyHandle(
  handle: string,
  wallet: string,
  bankrApiUrl = 'https://api.bankr.bot'
): Promise<void> {
  const url = new URL('/addresses/resolve', bankrApiUrl);
  url.searchParams.set('value', handle);
  url.searchParams.set('type', 'twitter');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (response.status !== 200) {
      throw new BankrVerificationUnavailableError();
    }

    const data = (await response.json()) as { resolved?: boolean; address?: string };
    if (data.resolved !== true || String(data.address ?? '').toLowerCase() !== wallet.toLowerCase()) {
      throw new BankrHandleMismatchError();
    }
  } catch (err) {
    if (err instanceof BankrHandleMismatchError) {
      throw err;
    }
    throw new BankrVerificationUnavailableError();
  }
}
