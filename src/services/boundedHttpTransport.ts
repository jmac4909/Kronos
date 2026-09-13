import * as http from 'http';
import * as https from 'https';

export interface BoundedHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
  responseType?: 'text' | 'buffer';
  signal?: AbortSignal;
  rejectUnauthorized?: boolean;
}

export interface BoundedHttpResponse<TBody = string | Buffer> {
  statusCode: number;
  body: TBody;
  headers: Record<string, string | string[] | undefined>;
}

export type BoundedHttpFailureKind = 'cancelled' | 'limit' | 'other';

export interface BoundedHttpTransportPolicy {
  allowHttp: 'any' | 'loopback';
  invalidUrl: string;
  invalidProtocol: string;
  responseLimit(maxResponseBytes: number): string;
  unexpectedResponse: string;
  timeout(timeoutMs: number): string;
  network: string;
  createError(message: string, kind: BoundedHttpFailureKind): Error;
}

/** One bounded GET transport shared by every provider client. */
export function boundedHttpTransport(
  request: BoundedHttpRequest & { responseType: 'buffer' },
  policy: BoundedHttpTransportPolicy,
): Promise<BoundedHttpResponse<Buffer>>;
export function boundedHttpTransport(
  request: BoundedHttpRequest & { responseType?: 'text' },
  policy: BoundedHttpTransportPolicy,
): Promise<BoundedHttpResponse<string>>;
export function boundedHttpTransport(
  request: BoundedHttpRequest,
  policy: BoundedHttpTransportPolicy,
): Promise<BoundedHttpResponse>;
export function boundedHttpTransport(
  request: BoundedHttpRequest,
  policy: BoundedHttpTransportPolicy,
): Promise<BoundedHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(policy.createError(policy.invalidUrl, 'other'));
      return;
    }
    const httpAllowed = parsed.protocol === 'http:'
      && (policy.allowHttp === 'any' || isLoopbackHostname(parsed.hostname));
    if (parsed.protocol !== 'https:' && !httpAllowed) {
      reject(policy.createError(policy.invalidProtocol, 'other'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const settleError = (message: string, kind: BoundedHttpFailureKind = 'other'): void => {
      if (settled) { return; }
      settled = true;
      reject(policy.createError(message, kind));
    };
    let req: http.ClientRequest;
    try {
      req = client.request(parsed, {
        method: request.method,
        timeout: request.timeoutMs,
        headers: request.headers,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(parsed.protocol === 'https:' && request.rejectUnauthorized !== undefined
          ? { rejectUnauthorized: request.rejectUnauthorized }
          : {}),
      }, res => {
        const declaredLength = firstHeaderString(res.headers['content-length']);
        if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > request.maxResponseBytes) {
          settleError(policy.responseLimit(request.maxResponseBytes), 'limit');
          res.destroy();
          req.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        res.on('data', chunk => {
          if (settled) { return; }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
          receivedBytes += buffer.length;
          if (receivedBytes > request.maxResponseBytes) {
            settleError(policy.responseLimit(request.maxResponseBytes), 'limit');
            res.destroy();
            req.destroy();
            return;
          }
          chunks.push(buffer);
        });
        res.on('end', () => {
          if (settled) { return; }
          settled = true;
          const body = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode || 0,
            body: request.responseType === 'buffer' ? body : body.toString('utf8'),
            headers: res.headers,
          });
        });
        res.on('aborted', () => settleError(policy.unexpectedResponse));
        res.on('error', () => settleError(policy.unexpectedResponse));
      });
    } catch {
      settleError(policy.network);
      return;
    }
    req.on('timeout', () => {
      settleError(policy.timeout(request.timeoutMs));
      req.destroy();
    });
    req.on('error', () => {
      const cancelled = Boolean(request.signal?.aborted);
      settleError(policy.network, cancelled ? 'cancelled' : 'other');
    });
    req.end();
  });
}

function firstHeaderString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
