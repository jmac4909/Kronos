import * as crypto from 'crypto';
import * as path from 'path';
import { ensureImmutablePrivateFilePair, ensurePrivateDirectoryPath } from './privateFilePrimitives';
import type { PromptLibraryPrompt, PromptTemplateContext } from './promptLibrary';
import { redactSensitiveTokens } from './sensitiveText';
import { KRONOS_DIR } from './stateStore';

export interface PromptLibraryArtifact {
  id: string;
  promptPath: string;
  jsonPath: string;
  contentSha256: string;
  createdAt: string;
  bodyRedacted: boolean;
  warnings: string[];
}

export interface WritePromptLibraryArtifactInput {
  prompt: PromptLibraryPrompt;
  editedBody: string;
  context: PromptTemplateContext;
  warnings?: readonly string[];
}

const MAX_BODY_LENGTH = 20_000;
const MAX_ARTIFACT_BYTES = 256 * 1024;
const FILE_MODE = 0o600;

/** Writes the exact reviewed prompt as an immutable private snapshot before non-submitting placement. */
export function writePromptLibraryArtifact(
  input: WritePromptLibraryArtifactInput,
  options: { kronosDir?: string; now?: Date } = {},
): PromptLibraryArtifact {
  const root = path.resolve(options.kronosDir || KRONOS_DIR);
  const originalBody = normalizedBody(input.editedBody);
  const body = redactSensitiveTokens(originalBody);
  const bodyRedacted = body !== originalBody;
  const createdAt = (options.now || new Date()).toISOString();
  const warnings = [...new Set([
    ...(input.warnings || []).map(warning => normalizedLine(warning, 500)),
    ...(bodyRedacted ? ['Credential-shaped text was redacted from the private prompt snapshot.'] : []),
  ].filter(Boolean))].slice(0, 20);
  const document = {
    schemaVersion: 1 as const,
    createdAt,
    library: {
      name: normalizedLine(input.prompt.libraryName, 200),
      sourceKind: input.prompt.sourceKind,
      sourceLocation: normalizedLine(input.prompt.sourceLocation, 4_000),
    },
    prompt: {
      id: normalizedLine(input.prompt.id, 80),
      title: normalizedLine(input.prompt.title, 200),
      revisionSha256: normalizedSha(input.prompt.revisionSha256),
      tags: input.prompt.tags.slice(0, 20).map(tag => normalizedLine(tag, 50)).filter(Boolean),
      suggestedContext: input.prompt.suggestedContext.slice(0, 20),
    },
    session: {
      title: normalizedLine(input.context.sessionTitle, 300),
      projectName: optionalLine(input.context.projectName, 200),
      projectPath: optionalLine(input.context.projectPath, 4_000),
      projectBranch: optionalLine(input.context.projectBranch, 500),
      jiraKeys: input.context.jiraKeys.slice(0, 50).map(key => normalizedLine(key, 160)).filter(Boolean),
    },
    body,
    warnings,
  };
  const json = `${JSON.stringify(document, null, 2)}\n`;
  const contentSha256 = sha256(json);
  const id = `PROMPT-${contentSha256.slice(0, 24).toUpperCase()}`;
  const directory = path.join(root, 'prompt-library-context', id);
  ensurePrivateDirectoryPath(directory, 'Kronos prompt library artifact');
  const jsonPath = path.join(directory, 'prompt.json');
  const promptPath = path.join(directory, 'prompt.md');
  const markdown = renderMarkdown(id, document, contentSha256);
  ensureImmutablePrivateFilePair(
    jsonPath,
    json,
    {
      label: 'Kronos prompt library JSON artifact',
      maxBytes: MAX_ARTIFACT_BYTES,
      temporaryPrefix: 'prompt-library-json',
      fileMode: FILE_MODE,
    },
    promptPath,
    markdown,
    {
      label: 'Kronos prompt library Markdown artifact',
      maxBytes: MAX_ARTIFACT_BYTES,
      temporaryPrefix: 'prompt-library-markdown',
      fileMode: FILE_MODE,
    },
  );
  return { id, promptPath, jsonPath, contentSha256, createdAt, bodyRedacted, warnings };
}

function renderMarkdown(
  id: string,
  document: {
    createdAt: string;
    library: { name: string; sourceKind: string; sourceLocation: string };
    prompt: { id: string; title: string; revisionSha256: string; tags: string[]; suggestedContext: readonly string[] };
    session: { title: string; projectName: string; projectPath: string; projectBranch: string; jiraKeys: string[] };
    body: string;
    warnings: string[];
  },
  contentSha256: string,
): string {
  return `# ${id} — ${document.prompt.title}

This is the exact prompt-library instruction reviewed by the operator before placement. It does not authorize Kronos to submit terminal input, run commands, or mutate a repository or provider.

## Provenance

- Library: ${document.library.name}
- Source: ${document.library.sourceKind} — ${document.library.sourceLocation}
- Prompt id: ${document.prompt.id}
- Library revision SHA-256: ${document.prompt.revisionSha256}
- Snapshot SHA-256: ${contentSha256}
- Created: ${document.createdAt}
- Session: ${document.session.title}
- Project: ${document.session.projectName || 'none'}
- Project path: ${document.session.projectPath || 'none'}
- Branch: ${document.session.projectBranch || 'unavailable'}
- Jira contexts: ${document.session.jiraKeys.join(', ') || 'none'}
- Tags: ${document.prompt.tags.join(', ') || 'none'}
- Suggested context: ${document.prompt.suggestedContext.join(', ') || 'none'}

${document.warnings.length > 0 ? `## Warnings\n\n${document.warnings.map(warning => `- ${warning}`).join('\n')}\n\n` : ''}## Reviewed instruction

${document.body}
`;
}

function normalizedBody(value: string): string {
  if (typeof value !== 'string') { throw new Error('Prompt library instruction must be text.'); }
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '')
    .trim();
  if (!normalized || normalized.length > MAX_BODY_LENGTH) {
    throw new Error(`Prompt library instruction must be 1-${MAX_BODY_LENGTH} characters.`);
  }
  return normalized;
}

function normalizedLine(value: string, maxLength: number): string {
  return redactSensitiveTokens(String(value || ''))
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function optionalLine(value: string | undefined, maxLength: number): string {
  return value ? normalizedLine(value, maxLength) : '';
}

function normalizedSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) { throw new Error('Prompt library revision hash is invalid.'); }
  return normalized;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
