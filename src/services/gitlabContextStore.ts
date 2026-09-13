import * as crypto from 'crypto';
import * as path from 'path';
import { ensureImmutablePrivateFilePair, ensurePrivateDirectoryPath } from './privateFilePrimitives';
import { KRONOS_DIR } from './stateStore';
import {
  type GitLabProviderContext,
  normalizeGitLabContextProjectName,
  normalizeGitLabContextTicketKey,
  normalizeGitLabMergeRequestIid,
  renderGitLabContextPrompt,
} from './gitlabMergeRequestContext';

export interface GitLabContextArtifactPaths {
  directoryPath: string;
  jsonPath: string;
  promptPath: string;
  contentSha256: string;
  promptSha256: string;
}

export interface GitLabContextStoreOptions {
  kronosDir?: string;
}

const FILE_MODE = 0o600;
const MAX_SERIALIZED_CONTEXT_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_BYTES = 13 * 1024 * 1024;

export function writeGitLabContextArtifacts(
  context: GitLabProviderContext,
  options: GitLabContextStoreOptions = {},
): GitLabContextArtifactPaths {
  validateContextEnvelope(context);
  const ownerDirectory = gitLabContextOwnerDirectory(context);
  const safeIid = normalizeGitLabMergeRequestIid(context.iid);
  const kronosDirectory = path.resolve(options.kronosDir || KRONOS_DIR);
  const rootPath = path.join(kronosDirectory, 'gitlab-context');
  const ownerPath = path.join(rootPath, ownerDirectory);
  const directoryPath = path.join(ownerPath, `MR-${safeIid}`);
  assertContainedPath(kronosDirectory, directoryPath);

  ensurePrivateDirectoryPath(directoryPath, 'Kronos GitLab context');

  const serializedContext = `${JSON.stringify(context, null, 2)}\n`;
  assertContentByteLimit(serializedContext, MAX_SERIALIZED_CONTEXT_BYTES, 'GitLab context JSON');
  const contentSha256 = crypto.createHash('sha256').update(serializedContext, 'utf8').digest('hex');
  const artifactId = contentSha256.slice(0, 24);
  const jsonPath = path.join(directoryPath, `context-${artifactId}.json`);
  const promptPath = path.join(directoryPath, `prompt-${artifactId}.md`);
  const prompt = renderGitLabContextPrompt(context, serializedContext);
  assertContentByteLimit(prompt, MAX_PROMPT_BYTES, 'GitLab context prompt');
  const promptSha256 = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
  ensureImmutablePrivateFilePair(
    jsonPath,
    serializedContext,
    {
      label: 'Kronos GitLab context JSON artifact',
      maxBytes: MAX_SERIALIZED_CONTEXT_BYTES,
      temporaryPrefix: 'gitlab-context-json',
      fileMode: FILE_MODE,
    },
    promptPath,
    prompt,
    {
      label: 'Kronos GitLab context prompt artifact',
      maxBytes: MAX_PROMPT_BYTES,
      temporaryPrefix: 'gitlab-context-prompt',
      fileMode: FILE_MODE,
    },
  );
  return { directoryPath, jsonPath, promptPath, contentSha256, promptSha256 };
}

function validateContextEnvelope(context: GitLabProviderContext): void {
  if (!context || typeof context !== 'object') {
    throw new Error('GitLab context artifact must be a normalized context object.');
  }
  if (context.schemaVersion !== 1 || context.source !== 'gitlab-rest') {
    throw new Error('GitLab context artifact has an unsupported schema or source.');
  }
  gitLabContextOwnerDirectory(context);
  normalizeGitLabMergeRequestIid(context.iid);
  if (context.mergeRequest.iid !== context.iid) {
    throw new Error('GitLab context artifact MR IID does not match its merge request details.');
  }
}

function gitLabContextOwnerDirectory(context: GitLabProviderContext): string {
  if ('ticketKey' in context) { return normalizeGitLabContextTicketKey(context.ticketKey); }
  const projectName = normalizeGitLabContextProjectName(context.projectName);
  return `PROJECT-${crypto.createHash('sha256').update(projectName).digest('hex').slice(0, 24).toUpperCase()}`;
}

function assertContainedPath(basePath: string, candidatePath: string): void {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw new Error('GitLab context artifact path escaped the configured Kronos directory.');
  }
}

function assertContentByteLimit(content: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte artifact safety limit.`);
  }
}
