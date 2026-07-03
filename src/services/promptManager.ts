import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { safeFileStem, safePromptFileName } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';

const GLOBAL_PROMPTS_DIR = path.join(KRONOS_DIR, 'prompts');
export const PROMPT_HISTORY_DIR = path.join(KRONOS_DIR, 'prompt-history');

export interface PromptTemplateInfo {
  name: string;
  path: string;
  source: 'project' | 'global';
  hash: string;
  modifiedAt: string;
  bytes: number;
  variables: string[];
}

export interface RenderPromptOptions {
  projectPath?: string;
}

export interface RenderedPrompt {
  name: string;
  text: string;
  path: string;
  source: 'project' | 'global';
  templateHash: string;
  renderedHash: string;
  modifiedAt: string;
  variables: string[];
  providedVariables: string[];
  missingVariables: string[];
}

export interface PromptSmokeTest {
  id: string;
  templateName: string;
  variables?: Record<string, string>;
  projectPath?: string;
  mustContain?: string[];
  mustNotContain?: string[];
  allowMissingVariables?: boolean;
  source?: 'default' | 'manifest';
}

export interface PromptSmokeResult {
  id: string;
  templateName: string;
  status: 'pass' | 'fail';
  source?: PromptSmokeTest['source'];
  templateHash?: string;
  renderedHash?: string;
  renderedBytes?: number;
  missingVariables: string[];
  errors: string[];
}

export interface PromptHistoryTemplate {
  name: string;
  path: string;
  source: 'project' | 'global';
  hash: string;
  modifiedAt: string;
  bytes: number;
  variables: string[];
}

export interface PromptHistorySnapshot {
  id: string;
  createdAt: string;
  scope: string;
  projectPath?: string;
  templateCount: number;
  templates: PromptHistoryTemplate[];
}

export interface PromptHistoryChange {
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  name: string;
  source: 'project' | 'global';
  path: string;
  beforeHash?: string;
  afterHash?: string;
  beforeModifiedAt?: string;
  afterModifiedAt?: string;
  beforeVariables?: string[];
  afterVariables?: string[];
}

export interface PromptHistoryDiff {
  previous?: PromptHistorySnapshot;
  current: PromptHistorySnapshot;
  changes: PromptHistoryChange[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

export interface PromptRepairResult {
  directory: string;
  created: string[];
  existing: string[];
  files: Array<{ name: string; path: string; status: 'created' | 'existing' }>;
}

const STARTER_PROMPT_VARIABLES: Record<string, string[]> = {
  'implement-system': [],
  'verify-local': ['TICKET_KEY'],
  'sonar-scan': ['PROJECT_NAME', 'SONAR_KEY', 'BRANCH'],
  'sonar-fix': ['PROJECT_NAME', 'SONAR_KEY', 'CUSTOM_INSTRUCTIONS'],
  'sonar-fix-branch': ['SONAR_KEY', 'TICKET_KEY', 'CUSTOM_INSTRUCTIONS'],
  'fix-finding': ['FINDING_DESC'],
  'verify-develop': ['PROJECT_NAME', 'TICKET_LIST'],
  'verify-test': ['PROJECT_NAME', 'TICKET_LIST'],
  'resolve-conflicts': ['BRANCH_ORDER'],
  'verify-combined': ['TICKET_KEYS', 'MERGE_COMMANDS', 'BRANCH_TABLE'],
  'continue-work': ['TICKET_KEY', 'BRANCH', 'FEEDBACK'],
};

export function promptDirs(projectPath?: string): Array<{ dir: string; source: 'project' | 'global' }> {
  const dirs: Array<{ dir: string; source: 'project' | 'global' }> = [];
  if (projectPath) {
    dirs.push({ dir: path.join(projectPath, '.claude', 'prompts'), source: 'project' });
  }
  dirs.push({ dir: GLOBAL_PROMPTS_DIR, source: 'global' });
  return dirs;
}

export function listPromptTemplates(projectPath?: string): PromptTemplateInfo[] {
  const byName = new Map<string, PromptTemplateInfo>();
  for (const { dir, source } of promptDirs(projectPath)) {
    if (!fs.existsSync(dir)) { continue; }
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) { continue; }
      const fullPath = path.join(dir, file);
      const name = path.basename(file, '.md');
      if (byName.has(name)) { continue; }
      byName.set(name, describePrompt(name, fullPath, source));
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function renderPrompt(name: string, vars: Record<string, string> = {}, options: RenderPromptOptions = {}): RenderedPrompt {
  const template = findPrompt(name, options.projectPath);
  if (!template) {
    throw new Error(`Prompt template not found: ${name}`);
  }

  let text = fs.readFileSync(template.path, 'utf-8');
  const missingVariables = template.variables.filter(v => vars[v] === undefined);
  for (const [key, value] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), value);
  }

  return {
    name,
    text,
    path: template.path,
    source: template.source,
    templateHash: template.hash,
    renderedHash: hashText(text),
    modifiedAt: template.modifiedAt,
    variables: template.variables,
    providedVariables: Object.keys(vars).sort(),
    missingVariables,
  };
}

export function buildDefaultPromptSmokeTests(
  templates: PromptTemplateInfo[],
  options: { projectPath?: string; idPrefix?: string } = {},
): PromptSmokeTest[] {
  return templates.map(template => ({
    id: `${options.idPrefix || 'default'}:${template.name}`,
    templateName: template.name,
    projectPath: options.projectPath,
    variables: Object.fromEntries(template.variables.map(variable => [variable, `fixture-${variable.toLowerCase()}`])),
    source: 'default',
  }));
}

export function runPromptSmokeTests(tests: PromptSmokeTest[]): PromptSmokeResult[] {
  return tests.map(test => {
    try {
      const rendered = renderPrompt(test.templateName, test.variables || {}, { projectPath: test.projectPath });
      const errors: string[] = [];
      if (!test.allowMissingVariables && rendered.missingVariables.length > 0) {
        errors.push(`Missing variables: ${rendered.missingVariables.join(', ')}`);
      }
      if (/\{\{[A-Z0-9_]+\}\}/.test(rendered.text)) {
        errors.push('Rendered prompt still contains unresolved {{VARIABLE}} placeholder(s).');
      }
      for (const expected of test.mustContain || []) {
        if (!rendered.text.includes(expected)) {
          errors.push(`Rendered prompt does not contain expected text: ${expected}`);
        }
      }
      for (const forbidden of test.mustNotContain || []) {
        if (rendered.text.includes(forbidden)) {
          errors.push(`Rendered prompt contains forbidden text: ${forbidden}`);
        }
      }
      return {
        id: test.id,
        templateName: test.templateName,
        status: errors.length === 0 ? 'pass' : 'fail',
        source: test.source,
        templateHash: rendered.templateHash,
        renderedHash: rendered.renderedHash,
        renderedBytes: Buffer.byteLength(rendered.text, 'utf-8'),
        missingVariables: rendered.missingVariables,
        errors,
      };
    } catch (e: unknown) {
      return {
        id: test.id,
        templateName: test.templateName,
        status: 'fail',
        source: test.source,
        missingVariables: [],
        errors: [unknownErrorMessage(e, 'Prompt smoke test failed')],
      };
    }
  });
}

export function createPromptHistorySnapshot(
  templates: PromptTemplateInfo[],
  options: { scope?: string; projectPath?: string; now?: Date } = {},
): PromptHistorySnapshot {
  const now = options.now || new Date();
  const scope = options.scope || 'global';
  const snapshot: PromptHistorySnapshot = {
    id: `${now.toISOString().replace(/[:.]/g, '-')}-${safeSnapshotPart(scope)}`,
    createdAt: now.toISOString(),
    scope,
    projectPath: options.projectPath,
    templateCount: templates.length,
    templates: templates.map(template => ({
      name: template.name,
      path: template.path,
      source: template.source,
      hash: template.hash,
      modifiedAt: template.modifiedAt,
      bytes: template.bytes,
      variables: [...template.variables],
    })).sort(compareHistoryTemplates),
  };
  writeJsonAtomic(promptSnapshotPath(snapshot.id), snapshot);
  return snapshot;
}

export function listPromptHistorySnapshots(limit = 50): PromptHistorySnapshot[] {
  if (!fs.existsSync(PROMPT_HISTORY_DIR)) { return []; }
  return fs.readdirSync(PROMPT_HISTORY_DIR)
    .filter(file => file.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(file => readPromptSnapshot(path.join(PROMPT_HISTORY_DIR, file)))
    .filter((snapshot): snapshot is PromptHistorySnapshot => Boolean(snapshot));
}

export function latestPromptHistorySnapshot(scope?: string): PromptHistorySnapshot | undefined {
  return listPromptHistorySnapshots().find(snapshot => !scope || snapshot.scope === scope);
}

export function diffPromptHistorySnapshots(current: PromptHistorySnapshot, previous?: PromptHistorySnapshot): PromptHistoryDiff {
  const changes = diffPromptTemplates(previous?.templates || [], current.templates);
  return {
    previous,
    current,
    changes,
    summary: {
      added: changes.filter(change => change.kind === 'added').length,
      removed: changes.filter(change => change.kind === 'removed').length,
      changed: changes.filter(change => change.kind === 'changed').length,
      unchanged: changes.filter(change => change.kind === 'unchanged').length,
    },
  };
}

export function diffPromptTemplates(previous: PromptHistoryTemplate[], current: PromptHistoryTemplate[]): PromptHistoryChange[] {
  const previousByKey = new Map(previous.map(template => [promptHistoryKey(template), template]));
  const currentByKey = new Map(current.map(template => [promptHistoryKey(template), template]));
  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  return Array.from(keys).sort().map(key => {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    if (!before && after) {
      return historyChange('added', after, undefined, after);
    }
    if (before && !after) {
      return historyChange('removed', before, before, undefined);
    }
    const anchor = after || before!;
    return historyChange(before!.hash === after!.hash ? 'unchanged' : 'changed', anchor, before, after);
  });
}

export function repairRequiredPromptTemplates(
  requiredNames: string[],
  options: { promptDir?: string; now?: Date } = {},
): PromptRepairResult {
  const promptDir = options.promptDir || GLOBAL_PROMPTS_DIR;
  fs.mkdirSync(promptDir, { recursive: true });
  const result: PromptRepairResult = { directory: promptDir, created: [], existing: [], files: [] };
  for (const name of requiredNames) {
    const promptPath = path.join(promptDir, safePromptFileName(name));
    if (fs.existsSync(promptPath)) {
      result.existing.push(name);
      result.files.push({ name, path: promptPath, status: 'existing' });
      continue;
    }
    writeTextAtomic(promptPath, starterPromptTemplate(name, options.now || new Date()));
    result.created.push(name);
    result.files.push({ name, path: promptPath, status: 'created' });
  }
  return result;
}

export function findPrompt(name: string, projectPath?: string): PromptTemplateInfo | null {
  const fileName = safePromptFileName(name);
  for (const { dir, source } of promptDirs(projectPath)) {
    const promptPath = path.join(dir, fileName);
    if (fs.existsSync(promptPath)) {
      return describePrompt(name, promptPath, source);
    }
  }
  return null;
}

function describePrompt(name: string, promptPath: string, source: 'project' | 'global'): PromptTemplateInfo {
  const text = fs.readFileSync(promptPath, 'utf-8');
  const stat = fs.statSync(promptPath);
  return {
    name,
    path: promptPath,
    source,
    hash: hashText(text),
    modifiedAt: stat.mtime.toISOString(),
    bytes: stat.size,
    variables: extractVariables(text),
  };
}

function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(match => match[1]))].sort();
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function promptSnapshotPath(snapshotId: string): string {
  return path.join(PROMPT_HISTORY_DIR, `${safeSnapshotPart(snapshotId)}.json`);
}

function readPromptSnapshot(filePath: string): PromptHistorySnapshot | null {
  try {
    const raw = readJsonFile(filePath) as PromptHistorySnapshot;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.templates)) { return null; }
    return raw;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function writeTextAtomic(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, filePath);
}

function starterPromptTemplate(name: string, now: Date): string {
  const variables = STARTER_PROMPT_VARIABLES[name] || [];
  const inputLines = variables.length > 0
    ? ['Inputs:', ...variables.map(variable => `- ${variable}: {{${variable}}}`), '']
    : [];
  return [
    `# Kronos prompt: ${name}`,
    '',
    `Generated by Kronos prompt repair on ${now.toISOString()}.`,
    '',
    ...inputLines,
    'Instructions:',
    '- Follow the repository instructions and existing project conventions.',
    '- Make the smallest complete change that satisfies the workflow objective.',
    '- Record concrete evidence: commands run, results, artifacts, and unresolved risks.',
    '- Do not hide failures. Stop and surface blockers when required context, credentials, or safe state is missing.',
    '',
  ].join('\n');
}

function compareHistoryTemplates(a: PromptHistoryTemplate, b: PromptHistoryTemplate): number {
  return promptHistoryKey(a).localeCompare(promptHistoryKey(b));
}

function promptHistoryKey(template: PromptHistoryTemplate): string {
  return `${template.source}:${template.name}:${template.path}`;
}

function historyChange(
  kind: PromptHistoryChange['kind'],
  anchor: PromptHistoryTemplate,
  before?: PromptHistoryTemplate,
  after?: PromptHistoryTemplate,
): PromptHistoryChange {
  return {
    kind,
    name: anchor.name,
    source: anchor.source,
    path: anchor.path,
    beforeHash: before?.hash,
    afterHash: after?.hash,
    beforeModifiedAt: before?.modifiedAt,
    afterModifiedAt: after?.modifiedAt,
    beforeVariables: before?.variables,
    afterVariables: after?.variables,
  };
}

function safeSnapshotPart(value: string): string {
  return safeFileStem(value, { fallback: 'prompt-snapshot', maxLength: 120 });
}
