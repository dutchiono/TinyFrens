import { TG_API } from './telegram.js';

export interface TelegramApiResponse {
  data: Record<string, unknown> | null;
  status: number;
}

export interface TelegramApiFile {
  data: Uint8Array;
  filename: string;
  contentType: string;
}

export interface TelegramBotApi {
  call(
    method: string,
    payload: Record<string, unknown>,
    token: string,
    files?: Record<string, TelegramApiFile>
  ): Promise<TelegramApiResponse>;
}

export class FetchTelegramBotApi implements TelegramBotApi {
  constructor(private fetcher: typeof fetch = fetch) {}

  async call(
    method: string,
    payload: Record<string, unknown>,
    token: string,
    files?: Record<string, TelegramApiFile>
  ): Promise<TelegramApiResponse> {
    let body: string | FormData;
    let headers: Record<string, string> | undefined;
    if (files) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        form.append(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      for (const [key, file] of Object.entries(files)) {
        const bytes = new ArrayBuffer(file.data.byteLength);
        new Uint8Array(bytes).set(file.data);
        form.append(key, new Blob([bytes], { type: file.contentType }), file.filename);
      }
      body = form;
    } else {
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify(payload);
    }
    const response = await this.fetcher(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(8_000),
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
