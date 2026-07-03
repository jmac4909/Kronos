import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { KRONOS_DIR } from './stateStore';
import { RequiredScriptName, ScriptHealth, requiredScripts } from './scriptClient';
import { safePromptFileName } from './fileNames';
import { unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';

export const INTEGRATION_MANIFEST_FILE = path.join(KRONOS_DIR, 'manifest.json');

export interface IntegrationManifest {
  version?: string;
  scripts?: Partial<Record<RequiredScriptName, { version?: string; sha256?: string; required?: boolean }>>;
  prompts?: Record<string, {
    sha256?: string;
    required?: boolean;
    smoke_tests?: PromptManifestSmokeTest[];
  }>;
  providers?: Record<string, { enabled?: boolean; baseUrl?: string }>;
}

export interface PromptManifestSmokeTest {
  name?: string;
  variables?: Record<string, string>;
  mustContain?: string[];
  mustNotContain?: string[];
  allowMissingVariables?: boolean;
}

export interface IntegrationManifestStatus {
  present: boolean;
  valid: boolean;
  path: string;
  manifest?: IntegrationManifest;
  errors: string[];
  warnings: string[];
}

export type ManifestAuditStatus = 'pass' | 'warn' | 'fail';

export interface ManifestArtifactAudit {
  kind: 'script' | 'prompt';
  name: string;
  path: string;
  status: ManifestAuditStatus;
  detail: string;
  expectedSha256?: string;
  actualSha256?: string;
}

export interface IntegrationManifestAudit {
  status: ManifestAuditStatus;
  summary: string;
  artifacts: ManifestArtifactAudit[];
}

export interface IntegrationManifestSnapshotResult {
  path: string;
  manifest: IntegrationManifest;
  status: IntegrationManifestStatus;
  audit: IntegrationManifestAudit;
}

export function readIntegrationManifest(filePath = INTEGRATION_MANIFEST_FILE): IntegrationManifestStatus {
  if (!fs.existsSync(filePath)) {
    return {
      present: false,
      valid: true,
      path: filePath,
      errors: [],
      warnings: ['Integration manifest not found. Script versions are unchecked.'],
    };
  }

  try {
    const manifest = readJsonFile(filePath) as IntegrationManifest;
    const status = validateIntegrationManifest(manifest);
    return { present: true, valid: status.errors.length === 0, path: filePath, manifest, ...status };
  } catch (e: unknown) {
    return {
      present: true,
      valid: false,
      path: filePath,
      errors: [unknownErrorMessage(e, 'Could not parse integration manifest.')],
      warnings: [],
    };
  }
}

export function validateIntegrationManifest(manifest: IntegrationManifest): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { errors: ['manifest.json must contain an object.'], warnings };
  }
  if (manifest.scripts !== undefined && (typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) {
    errors.push('manifest.scripts must be an object.');
  }
  if (manifest.prompts !== undefined && (typeof manifest.prompts !== 'object' || Array.isArray(manifest.prompts))) {
    errors.push('manifest.prompts must be an object.');
  }
  if (manifest.providers !== undefined && (typeof manifest.providers !== 'object' || Array.isArray(manifest.providers))) {
    errors.push('manifest.providers must be an object.');
  }

  const scriptNames = new Set(requiredScripts().map(script => script.name));
  for (const scriptName of Object.keys(manifest.scripts || {})) {
    if (!scriptNames.has(scriptName as RequiredScriptName)) {
      warnings.push(`Unknown script in manifest: ${scriptName}`);
    }
  }
  for (const script of requiredScripts()) {
    if (!manifest.scripts?.[script.name]) {
      warnings.push(`Required script not listed in manifest: ${script.name}`);
    }
  }
  for (const [promptName, entry] of Object.entries(manifest.prompts || {})) {
    try {
      safePromptFileName(promptName);
    } catch {
      errors.push(`manifest.prompts.${promptName} has an invalid prompt name.`);
      continue;
    }
    if (entry.smoke_tests !== undefined && !Array.isArray(entry.smoke_tests)) {
      errors.push(`manifest.prompts.${promptName}.smoke_tests must be an array.`);
      continue;
    }
    for (const [idx, smoke] of (entry.smoke_tests || []).entries()) {
      if (!smoke || typeof smoke !== 'object' || Array.isArray(smoke)) {
        errors.push(`manifest.prompts.${promptName}.smoke_tests[${idx}] must be an object.`);
        continue;
      }
      if (smoke.variables !== undefined && (typeof smoke.variables !== 'object' || Array.isArray(smoke.variables))) {
        errors.push(`manifest.prompts.${promptName}.smoke_tests[${idx}].variables must be an object.`);
      }
      if (smoke.mustContain !== undefined && !Array.isArray(smoke.mustContain)) {
        errors.push(`manifest.prompts.${promptName}.smoke_tests[${idx}].mustContain must be an array.`);
      }
      if (smoke.mustNotContain !== undefined && !Array.isArray(smoke.mustNotContain)) {
        errors.push(`manifest.prompts.${promptName}.smoke_tests[${idx}].mustNotContain must be an array.`);
      }
    }
  }

  return { errors, warnings };
}

export function buildIntegrationManifestSnapshot(
  options: { promptDir?: string; providers?: IntegrationManifest['providers']; version?: string } = {},
): IntegrationManifest {
  const scripts: IntegrationManifest['scripts'] = {};
  for (const script of requiredScripts()) {
    scripts[script.name] = {
      required: true,
      sha256: fs.existsSync(script.path) ? sha256File(script.path) : undefined,
    };
  }

  const promptDir = options.promptDir || path.join(KRONOS_DIR, 'prompts');
  const prompts: IntegrationManifest['prompts'] = {};
  if (fs.existsSync(promptDir)) {
    for (const file of fs.readdirSync(promptDir).filter(name => name.endsWith('.md')).sort()) {
      const promptPath = path.join(promptDir, file);
      if (!fs.statSync(promptPath).isFile()) { continue; }
      prompts[path.basename(file, '.md')] = {
        required: false,
        sha256: sha256File(promptPath),
      };
    }
  }

  return {
    version: options.version || 'local-snapshot',
    scripts,
    prompts,
    providers: options.providers || {},
  };
}

export function writeIntegrationManifestSnapshot(
  options: { filePath?: string; promptDir?: string; providers?: IntegrationManifest['providers']; version?: string } = {},
): IntegrationManifestSnapshotResult {
  const filePath = options.filePath || INTEGRATION_MANIFEST_FILE;
  const manifest = buildIntegrationManifestSnapshot(options);
  writeJsonAtomic(filePath, manifest);
  const status = readIntegrationManifest(filePath);
  const audit = auditIntegrationManifest(status, { promptDir: options.promptDir });
  return { path: filePath, manifest, status, audit };
}

export function auditIntegrationManifest(
  status: IntegrationManifestStatus = readIntegrationManifest(),
  options: { scripts?: ScriptHealth[]; promptDir?: string } = {},
): IntegrationManifestAudit {
  if (!status.present || !status.manifest) {
    return { status: 'warn', summary: 'Integration manifest missing; artifact hash audit skipped.', artifacts: [] };
  }
  if (!status.valid) {
    return { status: 'fail', summary: 'Integration manifest invalid; artifact hash audit skipped.', artifacts: [] };
  }

  const artifacts: ManifestArtifactAudit[] = [];
  const scripts = options.scripts || requiredScripts();
  for (const script of scripts) {
    const entry = status.manifest.scripts?.[script.name];
    artifacts.push(auditArtifact({
      kind: 'script',
      name: script.name,
      path: script.path,
      expectedSha256: entry?.sha256,
      required: entry?.required !== false,
    }));
  }

  const promptDir = options.promptDir || path.join(KRONOS_DIR, 'prompts');
  for (const [name, entry] of Object.entries(status.manifest.prompts || {})) {
    artifacts.push(auditArtifact({
      kind: 'prompt',
      name,
      path: path.join(promptDir, safePromptFileName(name)),
      expectedSha256: entry.sha256,
      required: entry.required !== false,
    }));
  }

  const failures = artifacts.filter(artifact => artifact.status === 'fail').length;
  const warnings = artifacts.filter(artifact => artifact.status === 'warn').length;
  const passes = artifacts.filter(artifact => artifact.status === 'pass').length;
  const aggregateStatus: ManifestAuditStatus = failures > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass';
  return {
    status: aggregateStatus,
    summary: `${passes} artifact hash check(s) passed, ${warnings} warning(s), ${failures} failure(s).`,
    artifacts,
  };
}

function auditArtifact(input: {
  kind: ManifestArtifactAudit['kind'];
  name: string;
  path: string;
  expectedSha256?: string;
  required: boolean;
}): ManifestArtifactAudit {
  const expected = normalizeSha256(input.expectedSha256);
  if (!input.expectedSha256) {
    return {
      kind: input.kind,
      name: input.name,
      path: input.path,
      status: input.required ? 'warn' : 'pass',
      detail: input.required ? 'No expected SHA-256 recorded in manifest.' : 'Optional artifact has no expected SHA-256.',
    };
  }
  if (!expected) {
    return {
      kind: input.kind,
      name: input.name,
      path: input.path,
      status: 'warn',
      detail: 'Manifest SHA-256 is not a 64 character hex digest.',
      expectedSha256: input.expectedSha256,
    };
  }
  if (!fs.existsSync(input.path)) {
    return {
      kind: input.kind,
      name: input.name,
      path: input.path,
      status: input.required ? 'fail' : 'warn',
      detail: input.required ? 'Required artifact is missing.' : 'Optional artifact is missing.',
      expectedSha256: expected,
    };
  }

  const actual = sha256File(input.path);
  const matches = actual === expected;
  return {
    kind: input.kind,
    name: input.name,
    path: input.path,
    status: matches ? 'pass' : 'fail',
    detail: matches ? 'SHA-256 matches manifest.' : 'SHA-256 does not match manifest.',
    expectedSha256: expected,
    actualSha256: actual,
  };
}

function normalizeSha256(value: string | undefined): string | undefined {
  if (!value) { return undefined; }
  const normalized = value.trim().toLowerCase().replace(/^sha256[:=\s-]*/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}
