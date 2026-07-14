import { createHash } from 'crypto';

interface SafeFileStemOptions {
  fallback?: string;
  maxLength?: number;
  hashLength?: number;
}

export function safeFileStem(value: string, options: SafeFileStemOptions = {}): string {
  const fallback = options.fallback || 'artifact';
  const maxLength = options.maxLength || 160;
  const hashLength = options.hashLength || 12;
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^-+|-+$/g, '') || fallback;
  if (sanitized.length <= maxLength) { return sanitized; }
  const hash = createHash('sha256').update(value).digest('hex').substring(0, hashLength);
  const prefixLength = Math.max(1, maxLength - hashLength - 1);
  return `${sanitized.substring(0, prefixLength)}-${hash}`;
}
