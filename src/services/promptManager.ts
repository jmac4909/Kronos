import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { safeFileStem, safePromptFileName } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';
import { escapeRegExp } from './regexp';
import { arrayFromUnknown, finiteNumberFromUnknown, isRecord, recordString, trimmedStringFromUnknown } from './records';

const GLOBAL_PROMPTS_DIR = path.join(KRONOS_DIR, 'prompts');
const PROMPT_HISTORY_DIR = path.join(KRONOS_DIR, 'prompt-history');

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

interface PromptHistoryTemplate {
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

interface PromptHistoryChange {
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

interface PromptRepairResult {
  directory: string;
  created: string[];
  existing: string[];
  files: Array<{ name: string; path: string; status: 'created' | 'existing' }>;
}

const STARTER_PROMPT_VARIABLES: Record<string, string[]> = {
  'implement-system': [],
  'verify-local': [
    'TICKET_KEY',
    'VERIFY_PROJECT_NAME',
    'VERIFY_BRANCH',
    'VERIFY_BRANCH_REF',
    'VERIFY_BRANCH_CHECKOUT',
    'VERIFY_ENVIRONMENT',
    'VERIFY_ENVIRONMENT_URL',
    'VERIFY_MODE',
    'VERIFY_MODE_DETAIL',
    'VERIFY_COMPLETION_POLICY',
    'VERIFY_TRACKING_HINTS',
    'VERIFY_TICKET_CONTEXT',
    'VERIFY_REPLAY_STEPS',
  ],
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

function promptDirs(projectPath?: string): Array<{ dir: string; source: 'project' | 'global' }> {
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
  return templates.map(template => {
    const test: PromptSmokeTest = {
      id: `${options.idPrefix || 'default'}:${template.name}`,
      templateName: template.name,
      variables: Object.fromEntries(template.variables.map(variable => [variable, `fixture-${variable.toLowerCase()}`])),
      source: 'default',
    };
    if (options.projectPath) { test.projectPath = options.projectPath; }
    return test;
  });
}

export function runPromptSmokeTests(tests: PromptSmokeTest[]): PromptSmokeResult[] {
  return tests.map(test => {
    try {
      const renderOptions: RenderPromptOptions = {};
      if (test.projectPath) { renderOptions.projectPath = test.projectPath; }
      const rendered = renderPrompt(test.templateName, test.variables || {}, renderOptions);
      const errors: string[] = [];
      if (!test.allowMissingVariables && rendered.missingVariables.length > 0) {
        errors.push(`Missing variables: ${rendered.missingVariables.join(', ')}`);
      }
      if (/\{\{[A-Z0-9_]+\}\}/.test(rendered.text)) {
        errors.push('Rendered prompt still contains one or more unresolved {{VARIABLE}} placeholders.');
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
  if (options.projectPath) { snapshot.projectPath = options.projectPath; }
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
  const diff: PromptHistoryDiff = {
    current,
    changes,
    summary: {
      added: changes.filter(change => change.kind === 'added').length,
      removed: changes.filter(change => change.kind === 'removed').length,
      changed: changes.filter(change => change.kind === 'changed').length,
      unchanged: changes.filter(change => change.kind === 'unchanged').length,
    },
  };
  if (previous) { diff.previous = previous; }
  return diff;
}

function diffPromptTemplates(previous: PromptHistoryTemplate[], current: PromptHistoryTemplate[]): PromptHistoryChange[] {
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

function findPrompt(name: string, projectPath?: string): PromptTemplateInfo | null {
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
  const variables = [...text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)]
    .map(match => match[1])
    .filter((variable): variable is string => Boolean(variable));
  return [...new Set(variables)].sort();
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function promptSnapshotPath(snapshotId: string): string {
  return path.join(PROMPT_HISTORY_DIR, `${safeSnapshotPart(snapshotId)}.json`);
}

function readPromptSnapshot(filePath: string): PromptHistorySnapshot | null {
  try {
    return promptHistorySnapshotFromUnknown(readJsonFile(filePath));
  } catch {
    return null;
  }
}

function promptHistorySnapshotFromUnknown(raw: unknown): PromptHistorySnapshot | null {
  if (!isRecord(raw)) { return null; }
  const templatesValue = raw['templates'];
  if (!Array.isArray(templatesValue)) { return null; }
  const templates = templatesValue
    .map(promptHistoryTemplateFromUnknown)
    .filter((template): template is PromptHistoryTemplate => Boolean(template))
    .sort(compareHistoryTemplates);
  const snapshot: PromptHistorySnapshot = {
    id: recordString(raw, 'id'),
    createdAt: recordString(raw, 'createdAt'),
    scope: recordString(raw, 'scope'),
    templateCount: templates.length,
    templates,
  };
  const projectPath = recordString(raw, 'projectPath');
  if (projectPath) { snapshot.projectPath = projectPath; }
  return snapshot;
}

function promptHistoryTemplateFromUnknown(value: unknown): PromptHistoryTemplate | null {
  if (!isRecord(value)) { return null; }
  const source = recordString(value, 'source');
  if (source !== 'project' && source !== 'global') { return null; }
  const name = recordString(value, 'name');
  const templatePath = recordString(value, 'path');
  if (!name || !templatePath) { return null; }
  return {
    name,
    path: templatePath,
    source,
    hash: recordString(value, 'hash'),
    modifiedAt: recordString(value, 'modifiedAt'),
    bytes: finiteNumberFromUnknown(value['bytes']),
    variables: arrayFromUnknown(value['variables']).map(item => trimmedStringFromUnknown(item)).filter(Boolean),
  };
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
  const workflowLines = name === 'verify-local'
    ? [
      'Verify-local workflow:',
      '- Use the operator-selected branch, environment, and mode exactly as provided above.',
      '- First find the original request/tracking ID from the Jira context, linked artifacts, payload logs, or application logs.',
      '- Replay the original request against the chosen environment.',
      '- If remote TEST/DEV/custom fix verification proves the defect no longer reproduces, report success and stop; do not build or start the app locally after remote success.',
      '- Only run local app verification when the selected environment is local-only, the remote replay fails or is inconclusive, or the operator explicitly asks for a local-only follow-up.',
      '- Compare before/after behavior and report a clear reproduced/fixed/not-fixed/blocked verdict.',
      '- Do not implement a fix during verify-local unless the operator explicitly starts a fix workflow.',
      '',
    ]
    : [];
  return [
    `# Kronos prompt: ${name}`,
    '',
    `Generated by Kronos prompt repair on ${now.toISOString()}.`,
    '',
    ...inputLines,
    ...workflowLines,
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
  const change: PromptHistoryChange = {
    kind,
    name: anchor.name,
    source: anchor.source,
    path: anchor.path,
  };
  if (before?.hash) { change.beforeHash = before.hash; }
  if (after?.hash) { change.afterHash = after.hash; }
  if (before?.modifiedAt) { change.beforeModifiedAt = before.modifiedAt; }
  if (after?.modifiedAt) { change.afterModifiedAt = after.modifiedAt; }
  if (before?.variables) { change.beforeVariables = before.variables; }
  if (after?.variables) { change.afterVariables = after.variables; }
  return change;
}

function safeSnapshotPart(value: string): string {
  return safeFileStem(value, { fallback: 'prompt-snapshot', maxLength: 120 });
}
