import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import { URL } from 'url';
import { unknownErrorMessage } from './errorUtils';

export type ProviderReachabilityStatus = 'pass' | 'warn' | 'fail';

export interface ProviderReachabilityTarget {
  name: string;
  enabled: boolean;
  url?: string;
}

export interface ProviderReachabilityResult {
  name: string;
  status: ProviderReachabilityStatus;
  detail: string;
}

export interface ProviderReachabilityOptions {
  timeoutMs?: number;
  useSystemCa?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
type TlsCaCertificateSet = 'bundled' | 'system';
type TlsWithCaCertificates = typeof tls & {
  getCACertificates?: (set: TlsCaCertificateSet) => string[];
};

export async function probeProviderReachability(
  targets: ProviderReachabilityTarget[],
  options: ProviderReachabilityOptions = {},
): Promise<ProviderReachabilityResult[]> {
  return Promise.all(targets.map(target => probeProvider(target, options)));
}

async function probeProvider(
  target: ProviderReachabilityTarget,
  options: ProviderReachabilityOptions,
): Promise<ProviderReachabilityResult> {
  if (!target.enabled) {
    return { name: target.name, status: 'pass', detail: 'Provider disabled by active profile.' };
  }

  const normalized = normalizeReachabilityUrl(target.url);
  if (!normalized.url) {
    return { name: target.name, status: normalized.status, detail: normalized.detail };
  }

  try {
    const result = await requestUrl(normalized.url, options.timeoutMs || DEFAULT_TIMEOUT_MS, 'HEAD', options);
    if (result.statusCode === 405) {
      return { ...(await requestUrl(normalized.url, options.timeoutMs || DEFAULT_TIMEOUT_MS, 'GET', options)), name: target.name };
    }
    return { ...result, name: target.name };
  } catch (e: unknown) {
    return { name: target.name, status: 'fail', detail: unknownErrorMessage(e, 'Reachability check failed.') };
  }
}

function normalizeReachabilityUrl(raw: string | undefined): { status: ProviderReachabilityStatus; detail: string; url?: URL } {
  const value = String(raw || '').trim();
  if (!value) {
    return { status: 'warn', detail: 'No base URL configured for this enabled provider.' };
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'fail', detail: `Unsupported URL scheme: ${url.protocol.replace(':', '')}` };
    }
    return { status: 'pass', detail: '', url };
  } catch (e: unknown) {
    return { status: 'fail', detail: unknownErrorMessage(e, 'Invalid provider URL.') };
  }
}

function requestUrl(url: URL, timeoutMs: number, method: 'HEAD' | 'GET', options: ProviderReachabilityOptions): Promise<ProviderReachabilityResult & { statusCode?: number }> {
  return new Promise(resolve => {
    const client = url.protocol === 'https:' ? https : http;
    const requestOptions: http.RequestOptions | https.RequestOptions = {
      method,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'kronos-doctor' },
    };
    const ca = url.protocol === 'https:' && options.useSystemCa !== false
      ? systemCaCertificatesForHttps()
      : undefined;
    if (ca) {
      (requestOptions as https.RequestOptions).ca = ca;
    }
    const req = client.request(url, requestOptions, res => {
      res.resume();
      const statusCode = res.statusCode || 0;
      const status: ProviderReachabilityStatus = statusCode >= 500 || statusCode === 0 ? 'warn' : 'pass';
      resolve({
        name: '',
        status,
        detail: `${method} ${safeUrlLabel(url)} returned HTTP ${statusCode}.`,
        statusCode,
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms reaching ${safeUrlLabel(url)}.`));
    });
    req.on('error', (error: Error) => {
      resolve({ name: '', status: 'fail', detail: error.message });
    });
    req.end();
  });
}

function safeUrlLabel(url: URL): string {
  const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
  return `${url.protocol}//${url.host}${path}`;
}

export function systemCaCertificatesForHttps(): string[] | undefined {
  const getCACertificates = (tls as TlsWithCaCertificates).getCACertificates;
  if (typeof getCACertificates !== 'function') {
    return undefined;
  }
  try {
    const bundled = getCACertificates('bundled') as string[];
    const system = getCACertificates('system') as string[];
    const combined = [...bundled, ...system].filter((cert): cert is string => typeof cert === 'string' && cert.length > 0);
    return Array.from(new Set(combined));
  } catch {
    return undefined;
  }
}
