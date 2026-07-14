/** JSON-safe Jira values that may be written to a context artifact. */
export type JiraArtifactValue =
  | string
  | number
  | boolean
  | JiraArtifactValue[]
  | { [key: string]: JiraArtifactValue };

export type JiraUnprunedValue =
  | JiraArtifactValue
  | null
  | JiraUnprunedValue[]
  | { [key: string]: JiraUnprunedValue };

/**
 * Recursively removes values that carry no operator-visible information.
 * Boolean false and numeric zero are deliberately retained.
 */
export function pruneEmptyJiraValue(value: JiraUnprunedValue): JiraArtifactValue | undefined {
  if (value === null) { return undefined; }
  if (typeof value === 'string') { return value.trim() ? value : undefined; }
  if (typeof value === 'number' || typeof value === 'boolean') { return value; }
  if (Array.isArray(value)) {
    const retained = value
      .map(pruneEmptyJiraValue)
      .filter((item): item is JiraArtifactValue => item !== undefined);
    return retained.length > 0 ? retained : undefined;
  }

  const retained: { [key: string]: JiraArtifactValue } = {};
  for (const [key, item] of Object.entries(value)) {
    const pruned = pruneEmptyJiraValue(item);
    if (pruned !== undefined) { retained[key] = pruned; }
  }
  return Object.keys(retained).length > 0 ? retained : undefined;
}

/** Recognizes an ADF document whose rich-text content is semantically empty. */
export function isEmptyJiraRichText(value: unknown): boolean {
  return isRecord(value)
    && value['type'] === 'doc'
    && Array.isArray(value['content'])
    && !hasMeaningfulRichTextNode(value, new WeakSet<object>(), 0);
}

function hasMeaningfulRichTextNode(value: unknown, seen: WeakSet<object>, depth: number): boolean {
  if (depth > 40 || value === null || value === undefined) { return false; }
  if (typeof value === 'string') { return Boolean(value.trim()); }
  if (typeof value === 'number' || typeof value === 'boolean') { return true; }
  if (typeof value !== 'object') { return false; }
  if (seen.has(value)) { return false; }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some(item => hasMeaningfulRichTextNode(item, seen, depth + 1));
    }
    if (!isRecord(value)) { return false; }
    const type = typeof value['type'] === 'string' ? value['type'] : '';
    if (type === 'text') {
      return typeof value['text'] === 'string' && Boolean(value['text'].trim());
    }
    if (type === 'rule') { return true; }
    if (['mention', 'emoji', 'date', 'status', 'inlineCard', 'blockCard', 'embedCard', 'media'].includes(type)) {
      const attrs = isRecord(value['attrs']) ? value['attrs'] : {};
      if (Object.values(attrs).some(item => typeof item === 'string' && Boolean(item.trim()))) { return true; }
    }
    const content = Array.isArray(value['content']) ? value['content'] : [];
    return content.some(item => hasMeaningfulRichTextNode(item, seen, depth + 1));
  } finally {
    seen.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
