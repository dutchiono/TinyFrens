import { DatabaseConnection } from '../db/connection.js';
import { Config } from '../config.js';
import { RateLimiter } from '../rate-limit.js';
import webpush from 'web-push';

export interface PushSubscriptionInfo {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  send(
    subscription: PushSubscriptionInfo,
    payload: unknown,
    options: { vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject?: string }
  ): Promise<{ status: number }>;
}

export function pushConfigured(config: Config): boolean {
  return Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);
}

export class DefaultPushSender implements PushSender {
  async send(
    subscription: PushSubscriptionInfo,
    payload: unknown,
    options: { vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject?: string }
  ): Promise<{ status: number }> {
    if (!options.vapidPublicKey || !options.vapidPrivateKey || !options.vapidSubject) {
      throw new Error('Web Push is not configured');
    }
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: {
        subject: options.vapidSubject,
        publicKey: options.vapidPublicKey,
        privateKey: options.vapidPrivateKey,
      },
    });
    return { status: result.statusCode };
  }
}

export async function deliverPush(
  db: DatabaseConnection,
  config: Config,
  rows: Array<[string, string, string]> | PushSubRow[],
  payload: unknown,
  sender?: PushSender
): Promise<void> {
  const key = config.VAPID_PRIVATE_KEY;
  const subject = config.VAPID_SUBJECT;
  const activeSender = sender || new DefaultPushSender();

  for (const row of rows) {
    const endpoint = Array.isArray(row) ? row[0] : row.endpoint;
    const p256dh = Array.isArray(row) ? row[1] : row.p256dh;
    const auth = Array.isArray(row) ? row[2] : row.auth;

    try {
      const res = await activeSender.send(
        { endpoint, keys: { p256dh, auth } },
        payload,
        { vapidPublicKey: config.VAPID_PUBLIC_KEY, vapidPrivateKey: key, vapidSubject: subject }
      );

      if (res && (res.status === 404 || res.status === 410)) {
        try {
          db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint);
        } catch {
          // ignore db error
        }
      }
    } catch (exc: any) {
      const status = exc?.status || exc?.statusCode || exc?.response?.status;
      if (status === 404 || status === 410) {
        try {
          db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(endpoint);
        } catch {
          // ignore db error
        }
      }
    }
  }
}

export async function pushOffline(
  db: DatabaseConnection,
  config: Config,
  rateLimiter: RateLimiter,
  nowSeconds: number,
  pid: string,
  title: string,
  body: string,
  sender?: PushSender
): Promise<void> {
  if (!pushConfigured(config)) return;
  try {
    rateLimiter.limit(`push:${pid}`, 10, 3600, nowSeconds);
  } catch {
    return;
  }
  const rows = db.prepare<PushSubRow>('SELECT endpoint, p256dh, auth FROM push_subs WHERE pid=?').all(pid);
  if (!rows || rows.length === 0) return;
  await deliverPush(db, config, rows, { title, body, url: './index.html' }, sender);
}
