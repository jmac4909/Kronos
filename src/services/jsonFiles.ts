import { unknownErrorMessage } from './errorUtils';

interface ParseJsonWithLabelOptions {
  includePreview?: boolean;
  previewLength?: number;
}

export function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

export function parseJsonWithLabel<T = unknown>(raw: string, label: string, options: ParseJsonWithLabelOptions = {}): T {
  const content = stripUtf8Bom(raw);
  try {
    return JSON.parse(content) as T;
  } catch (e: unknown) {
    const previewLength = options.previewLength ?? 300;
    const preview = options.includePreview ? content.trim().substring(0, previewLength) : '';
    throw new Error(`Invalid JSON from ${label}: ${unknownErrorMessage(e, 'parse failed')}${preview ? `; output: ${preview}` : ''}`);
  }
}
