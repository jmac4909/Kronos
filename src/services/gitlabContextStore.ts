import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { KRONOS_DIR } from './stateStore';
import {
  GitLabMergeRequestContext,
  normalizeGitLabContextTicketKey,
  normalizeGitLabMergeRequestIid,
  renderGitLabContextPrompt,
} from './gitlabMergeRequestContext';

export interface GitLabContextArtifactPaths {
  directoryPath: string;
  jsonPath: string;
  promptPath: string;
  contentSha256: string;
}

export interface GitLabContextStoreOptions {
  kronosDir?: string;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_SERIALIZED_CONTEXT_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_BYTES = 13 * 1024 * 1024;

export function writeGitLabContextArtifacts(
  context: GitLabMergeRequestContext,
  options: GitLabContextStoreOptions = {},
): GitLabContextArtifactPaths {
  validateContextEnvelope(context);
  const safeTicketKey = normalizeGitLabContextTicketKey(context.ticketKey);
  const safeIid = normalizeGitLabMergeRequestIid(context.iid);
  const kronosDirectory = path.resolve(options.kronosDir || KRONOS_DIR);
  const rootPath = path.join(kronosDirectory, 'gitlab-context');
  const ticketPath = path.join(rootPath, safeTicketKey);
  const directoryPath = path.join(ticketPath, `MR-${safeIid}`);
  assertContainedPath(kronosDirectory, directoryPath);

  ensureKronosDirectory(kronosDirectory);
  ensurePrivateDirectory(rootPath);
  ensurePrivateDirectory(ticketPath);
  ensurePrivateDirectory(directoryPath);

  const serializedContext = `${JSON.stringify(context, null, 2)}\n`;
  assertContentByteLimit(serializedContext, MAX_SERIALIZED_CONTEXT_BYTES, 'GitLab context JSON');
  const contentSha256 = crypto.createHash('sha256').update(serializedContext, 'utf8').digest('hex');
  const artifactId = contentSha256.slice(0, 24);
  const jsonPath = path.join(directoryPath, `context-${artifactId}.json`);
  const promptPath = path.join(directoryPath, `prompt-${artifactId}.md`);
  const prompt = renderGitLabContextPrompt(context, serializedContext);
  assertContentByteLimit(prompt, MAX_PROMPT_BYTES, 'GitLab context prompt');
  if (reuseExistingArtifactPair(jsonPath, serializedContext, promptPath, prompt)) {
    return { directoryPath, jsonPath, promptPath, contentSha256 };
  }

  const stagedJson = stagePrivateFile(jsonPath, serializedContext);
  let stagedPrompt: string | undefined;
  const stagedJsonIdentity = fileIdentity(stagedJson);
  let stagedPromptIdentity: FileIdentity | undefined;
  try {
    stagedPrompt = stagePrivateFile(promptPath, prompt);
    stagedPromptIdentity = fileIdentity(stagedPrompt);
    commitPrivateFile(stagedJson, jsonPath);
    commitPrivateFile(stagedPrompt, promptPath);
    syncDirectory(directoryPath);
  } catch (error: unknown) {
    removeFileIfIdentityMatches(jsonPath, stagedJsonIdentity);
    if (stagedPromptIdentity) { removeFileIfIdentityMatches(promptPath, stagedPromptIdentity); }
    removeFileIfPresent(stagedJson);
    if (stagedPrompt) { removeFileIfPresent(stagedPrompt); }
    throw error;
  }
  return { directoryPath, jsonPath, promptPath, contentSha256 };
}

interface FileIdentity {
  dev: number;
  ino: number;
}

function reuseExistingArtifactPair(
  jsonPath: string,
  serializedContext: string,
  promptPath: string,
  prompt: string,
): boolean {
  const jsonStat = lstatIfPresent(jsonPath);
  const promptStat = lstatIfPresent(promptPath);
  if (!jsonStat && !promptStat) { return false; }

  if (!jsonStat || !promptStat) {
    if (jsonStat) { assertRegularArtifact(jsonPath, jsonStat, 'GitLab context JSON artifact'); }
    if (promptStat) { assertRegularArtifact(promptPath, promptStat, 'GitLab context prompt artifact'); }
    throw new Error('GitLab context artifact pair is incomplete; refusing to replace or complete immutable artifacts.');
  }

  assertArtifactBytes(jsonPath, jsonStat, serializedContext, 'GitLab context JSON artifact');
  assertArtifactBytes(promptPath, promptStat, prompt, 'GitLab context prompt artifact');
  setPrivateMode(jsonPath, FILE_MODE);
  setPrivateMode(promptPath, FILE_MODE);
  return true;
}

function assertArtifactBytes(
  filePath: string,
  stat: fs.Stats,
  expectedContent: string,
  label: string,
): void {
  assertRegularArtifact(filePath, stat, label);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, readOnlyNoFollowFlags());
    const openedStat = fs.fstatSync(descriptor);
    assertRegularArtifact(filePath, openedStat, label);
    if (openedStat.dev !== stat.dev || openedStat.ino !== stat.ino) {
      throw new Error(`${label} changed while it was being validated: ${filePath}`);
    }
    const actualContent = fs.readFileSync(descriptor);
    const currentStat = fs.lstatSync(filePath);
    assertRegularArtifact(filePath, currentStat, label);
    if (currentStat.dev !== openedStat.dev || currentStat.ino !== openedStat.ino) {
      throw new Error(`${label} changed while it was being validated: ${filePath}`);
    }
    if (!actualContent.equals(Buffer.from(expectedContent, 'utf8'))) {
      throw new Error(`${label} content does not match its immutable content address: ${filePath}`);
    }
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

function assertRegularArtifact(filePath: string, stat: fs.Stats, label: string): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} path may not be a symbolic link: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} path must be a regular file: ${filePath}`);
  }
}

function validateContextEnvelope(context: GitLabMergeRequestContext): void {
  if (!context || typeof context !== 'object') {
    throw new Error('GitLab context artifact must be a normalized context object.');
  }
  if (context.schemaVersion !== 1 || context.source !== 'gitlab-rest') {
    throw new Error('GitLab context artifact has an unsupported schema or source.');
  }
  normalizeGitLabContextTicketKey(context.ticketKey);
  normalizeGitLabMergeRequestIid(context.iid);
  if (context.mergeRequest.iid !== context.iid) {
    throw new Error('GitLab context artifact MR IID does not match its merge request details.');
  }
}

function ensureKronosDirectory(directoryPath: string): void {
  assertNoSymbolicLinkComponents(directoryPath);
  const existing = lstatIfPresent(directoryPath);
  if (existing) {
    const stat = existing;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Kronos data path is not a directory: ${directoryPath}`);
    }
    return;
  }
  fs.mkdirSync(directoryPath, { recursive: true, mode: DIRECTORY_MODE });
  assertNoSymbolicLinkComponents(directoryPath);
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Kronos data path is not a directory: ${directoryPath}`);
  }
  setPrivateMode(directoryPath, DIRECTORY_MODE);
}

function ensurePrivateDirectory(directoryPath: string): void {
  assertNoSymbolicLinkComponents(directoryPath);
  if (!lstatIfPresent(directoryPath)) {
    fs.mkdirSync(directoryPath, { mode: DIRECTORY_MODE });
  }
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`GitLab context artifact path is not a private directory: ${directoryPath}`);
  }
  setPrivateMode(directoryPath, DIRECTORY_MODE);
}

function assertNoSymbolicLinkComponents(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length);
  const components = relative.split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = lstatIfPresent(current);
    if (!stat) { continue; }
    if (stat.isSymbolicLink()) {
      throw new Error(`GitLab context artifact paths may not contain symbolic links: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`GitLab context artifact path component is not a directory: ${current}`);
    }
  }
}

function stagePrivateFile(filePath: string, content: string): string {
  assertNoSymbolicLinkComponents(path.dirname(filePath));
  assertArtifactPathAbsent(filePath, 'GitLab context artifact');
  const suffix = crypto.randomBytes(12).toString('hex');
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${suffix}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', FILE_MODE);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    setPrivateMode(temporaryPath, FILE_MODE);
    return temporaryPath;
  } catch (error: unknown) {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
    removeFileIfPresent(temporaryPath);
    throw error;
  }
}

function commitPrivateFile(temporaryPath: string, filePath: string): void {
  assertNoSymbolicLinkComponents(path.dirname(filePath));
  assertArtifactPathAbsent(filePath, 'GitLab context artifact');
  fs.linkSync(temporaryPath, filePath);
  const stat = fs.lstatSync(filePath);
  assertRegularArtifact(filePath, stat, 'GitLab context artifact');
  setPrivateMode(filePath, FILE_MODE);
  fs.unlinkSync(temporaryPath);
}

function assertArtifactPathAbsent(filePath: string, label: string): void {
  const stat = lstatIfPresent(filePath);
  if (!stat) { return; }
  assertRegularArtifact(filePath, stat, label);
  throw new Error(`${label} already exists; refusing to overwrite immutable content: ${filePath}`);
}

function fileIdentity(filePath: string): FileIdentity {
  const stat = fs.lstatSync(filePath);
  assertRegularArtifact(filePath, stat, 'Staged GitLab context artifact');
  return { dev: stat.dev, ino: stat.ino };
}

function removeFileIfIdentityMatches(filePath: string, identity: FileIdentity): void {
  const stat = lstatIfPresent(filePath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) { return; }
  if (stat.dev === identity.dev && stat.ino === identity.ino) {
    fs.unlinkSync(filePath);
  }
}

function assertContainedPath(basePath: string, candidatePath: string): void {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw new Error('GitLab context artifact path escaped the configured Kronos directory.');
  }
}

function setPrivateMode(filePath: string, mode: number): void {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, mode);
  }
}

function assertContentByteLimit(content: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte artifact safety limit.`);
  }
}

function noFollowFlag(): number {
  return typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
}

function directoryFlag(): number {
  return typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;
}

function readOnlyNoFollowFlags(): number {
  return fs.constants.O_RDONLY | noFollowFlag();
}

function syncDirectory(directoryPath: string): void {
  if (process.platform === 'win32') { return; }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | directoryFlag() | noFollowFlag());
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

function removeFileIfPresent(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error: unknown) {
    if (!isMissingFileError(error)) { throw error; }
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT');
}

function lstatIfPresent(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) { return undefined; }
    throw error;
  }
}
