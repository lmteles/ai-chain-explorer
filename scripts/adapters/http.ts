import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const CACHE_DIR = '.cache';
const lastByHost = new Map<string, number>();

/** Query parameters that carry secrets: never written to disk names, logs or runs.json. */
const SECRET_PARAMS = ['apikey', 'api_key', 'token', 'key'];

export function redact(text: string): string {
  return text.replace(new RegExp(`([?&](?:${SECRET_PARAMS.join('|')})=)[A-Za-z0-9_.~-]+`, 'gi'), '$1REDACTED');
}

export type GetOptions = { ttlMs: number; minGapMs?: number; headers?: Record<string, string> };

/**
 * GET with an on-disk cache and a per-host minimum gap between requests. Returns the body as text.
 * Errors carry the redacted URL only.
 */
export async function cachedGet(url: string, { ttlMs, minGapMs = 150, headers = {} }: GetOptions): Promise<string> {
  const safe = redact(url);
  const file = `${CACHE_DIR}/${safe.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_').slice(0, 200)}`;
  try {
    if (Date.now() - statSync(file).mtimeMs < ttlMs) return readFileSync(file, 'utf8');
  } catch { /* not cached */ }
  const host = new URL(url).host;
  const wait = (lastByHost.get(host) ?? 0) + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastByHost.set(host, Date.now());
  const res = await fetch(url, { headers }).catch((e: Error) => { throw new Error(`${safe}: ${e.message}`); });
  if (!res.ok) throw new Error(`${safe}: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, text);
  return text;
}

export const HOUR = 3600 * 1000;
