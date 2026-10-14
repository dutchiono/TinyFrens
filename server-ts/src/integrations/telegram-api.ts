import { TG_API } from './telegram.js';

export interface TelegramApiResponse {
  data: Record<string, unknown> | null;
  status: number;
}

export interface TelegramBotApi {
  call(method: string, payload: Record<string, unknown>, token: string): Promise<TelegramApiResponse>;
}

export class FetchTelegramBotApi implements TelegramBotApi {
  constructor(private fetcher: typeof fetch = fetch) {}

  async call(
    method: string,
    payload: Record<string, unknown>,
    token: string
  ): Promise<TelegramApiResponse> {
    const response = await this.fetcher(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data: Record<string, unknown> | null = null;
    try {
      data = await response.json() as Record<string, unknown>;
    } catch {
      data = null;
    }
    return { data, status: response.status };
  }
}
