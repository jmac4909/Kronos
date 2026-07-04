import * as fs from 'fs';
import * as path from 'path';
import { KronosState, QueueState } from '../state/types';
import { auditIntegrationManifest, IntegrationManifest, readIntegrationManifest } from './integrationManifest';
import { listPromptTemplates } from './promptManager';
import { KronosProfile } from './profileManager';
import { ProviderReachabilityOptions, ProviderReachabilityTarget, probeProviderReachability } from './providerReachability';
import { requiredScripts } from './scriptClient';
import { KRONOS_DIR } from './stateStore';
import { defaultCliProbeCommandRunner, readableGoogleApplicationCredentials, resolveGcloudCommandStatus } from './cliProbes';
import { unknownErrorMessage } from './errorUtils';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorChecksInput {
  state: KronosState | null;
  queue: QueueState | null;
  stateLoadErrors?: Array<{ target: 'state.json' | 'queue.json' | string; filePath?: string; detail: string }>;
  sessionStoreIssues?: Array<{ kind: string; filePath: string; detail: string }>;
  profile: KronosProfile;
  requiredPrompts: string[];
  dispatchModel: string;
  kronosDir?: string;
  env?: Record<string, string | undefined>;
  platform?: string;
  gcloudExistsSync?: (filePath: string) => boolean;
  commandRunner?: DoctorCommandRunner;
}

export interface DoctorCommandOptions {
  timeoutMs: number;
}

export type DoctorCommandRunner = (command: string, args: string[], options: DoctorCommandOptions) => string;

const COMMAND_TIMEOUT_MS = 5000;
const TOKEN_TIMEOUT_MS = 10000;
const MAX_COMMAND_BUFFER = 1024 * 1024;

export function runDoctorChecks(input: DoctorChecksInput): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const kronosDir = input.kronosDir || KRONOS_DIR;
  const promptsDir = path.join(kronosDir, 'prompts');
  const env = input.env || process.env;
  const commandRunner = input.commandRunner || defaultCommandRunner;

  const add = (name: string, status: DoctorCheck['status'], detail: string) => checks.push({ name, status, detail });
  const fileCheck = (name: string, filePath: string) => {
    add(name, fs.existsSync(filePath) ? 'pass' : 'fail', filePath);
  };

  fileCheck('Kronos state directory', kronosDir);
  const manifestStatus = readIntegrationManifest();
  const manifestAudit = auditIntegrationManifest(manifestStatus);
  const manifestScripts = manifestStatus.manifest?.scripts || {};
  for (const script of requiredScripts()) {
    const entry = manifestScripts[script.name];
    const version = entry?.version ? `version ${entry.version}` : 'version unknown';
    add(script.name, script.present ? 'pass' : 'fail', `${script.path} (${version})`);
  }
  add(
    'Integration manifest',
    !manifestStatus.present ? 'warn' : manifestStatus.valid ? (manifestStatus.warnings.length ? 'warn' : 'pass') : 'fail',
    manifestStatus.present
      ? `${manifestStatus.path}${manifestStatus.errors.length ? ` - ${manifestStatus.errors.join('; ')}` : manifestStatus.warnings.length ? ` - ${manifestStatus.warnings.join('; ')}` : ''}`
      : manifestStatus.warnings.join('; ')
  );
  add('Manifest artifact hashes', manifestAudit.status, manifestAudit.summary);
  fileCheck('Prompt directory', promptsDir);

  try {
    const templates = listPromptTemplates();
    const names = new Set(templates.map(t => t.name));
    const missing = input.requiredPrompts.filter(name => !names.has(name));
    add(
      'Prompt templates',
      missing.length === 0 ? 'pass' : 'warn',
      `${templates.length} template(s), ${missing.length} required missing${missing.length ? `: ${missing.join(', ')}. Run Kronos: Repair Prompt Pack to create starter templates.` : ''}`
    );
  } catch (e: unknown) {
    add('Prompt templates', 'fail', unknownErrorMessage(e, 'Could not read prompt directory'));
  }

  commandCheck(checks, commandRunner, 'Python', 'python', ['--version']);
  commandCheck(checks, commandRunner, 'Git', 'git', ['--version']);
  claudeVersionCheck(checks, commandRunner);
  const readableGacFile = readableGoogleApplicationCredentials({ env: env as NodeJS.ProcessEnv });
  const gcloudResolutionOptions: { env: NodeJS.ProcessEnv; platform?: string; existsSync?: (filePath: string) => boolean } = {
    env: env as NodeJS.ProcessEnv,
  };
  if (input.platform) { gcloudResolutionOptions.platform = input.platform; }
  if (input.gcloudExistsSync) { gcloudResolutionOptions.existsSync = input.gcloudExistsSync; }
  const gcloudResolution = readableGacFile ? undefined : resolveGcloudCommandStatus(gcloudResolutionOptions);
  const gcloudCommand = gcloudResolution?.command || '';
  if (readableGacFile) {
    add('GCloud CLI', 'pass', 'Skipped because GOOGLE_APPLICATION_CREDENTIALS points to a readable file.');
  } else if (!gcloudResolution?.available) {
    add('GCloud CLI', 'fail', `${gcloudCommand} unavailable; install Google Cloud SDK or set GOOGLE_APPLICATION_CREDENTIALS.`);
  } else {
    commandCheck(checks, commandRunner, 'GCloud CLI', gcloudCommand, ['--version']);
  }

  add('Active integration profile', 'pass', `${input.profile.label} (${input.profile.id})`);
  credentialCheck(checks, env, 'Jira credentials', input.profile.providers.jira, ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  credentialCheck(checks, env, 'GitLab credentials', input.profile.providers.gitlab, ['GITLAB_TOKEN']);
  credentialCheck(checks, env, 'Jenkins credentials', input.profile.providers.jenkins, ['JENKINS_URL']);
  credentialCheck(checks, env, 'SonarQube credentials', input.profile.providers.sonar, ['SONAR_HOST_URL', 'SONAR_TOKEN']);
  credentialAnyCheck(checks, env, 'GitHub Actions credentials', input.profile.providers.githubActions, ['GITHUB_TOKEN', 'GH_TOKEN']);

  if (readableGacFile) {
    add('GCP application default auth', 'pass', 'GOOGLE_APPLICATION_CREDENTIALS file is readable; skipped gcloud token command.');
  } else if (!gcloudResolution?.available) {
    add('GCP application default auth', 'warn', `${gcloudCommand} unavailable; install Google Cloud SDK or set GOOGLE_APPLICATION_CREDENTIALS.`);
  } else {
    try {
      commandRunner(gcloudCommand, ['auth', 'application-default', 'print-access-token'], { timeoutMs: TOKEN_TIMEOUT_MS });
      add('GCP application default auth', 'pass', 'Token command succeeded');
    } catch (e: unknown) {
      add('GCP application default auth', 'warn', unknownErrorMessage(e, 'Auth check failed'));
    }
  }

  const stateLoadError = input.stateLoadErrors?.find(error => error.target === 'state.json');
  const queueLoadError = input.stateLoadErrors?.find(error => error.target === 'queue.json');

  if (input.state) {
    const projectCount = Object.keys(input.state.projects || {}).length;
    const ticketCount = Object.keys(input.state.tickets || {}).length;
    const stateWarnings = input.stateLoadErrors?.filter(error => error.target === 'state.json') || [];
    add(
      'state.json parse',
      stateWarnings.length > 0 ? 'warn' : 'pass',
      `${projectCount} project(s), ${ticketCount} ticket(s)${stateWarnings.length ? `; ${stateWarnings.slice(0, 3).map(error => error.detail).join('; ')}${stateWarnings.length > 3 ? `; and ${stateWarnings.length - 3} more` : ''}` : ''}`
    );
    const missingConfig = projectConfigGaps(input.state, input.profile);
    add(
      'Project config completeness',
      missingConfig.length === 0 ? 'pass' : 'warn',
      missingConfig.length === 0 ? 'All configured projects satisfy active profile requirements.' : `${missingConfig.slice(0, 8).join('; ')}${missingConfig.length > 8 ? `; and ${missingConfig.length - 8} more` : ''}`
    );
  } else if (stateLoadError) {
    add('state.json parse', 'fail', `${stateLoadError.filePath || 'state.json'} - ${stateLoadError.detail}`);
    add('Project config completeness', 'fail', 'state.json could not be parsed or validated.');
  } else {
    add('state.json parse', 'warn', 'No readable state loaded yet. Run setup/discover/refresh.');
    add('Project config completeness', 'warn', 'No readable state loaded yet.');
  }

  if (input.queue) {
    add('queue.json parse', 'pass', `${input.queue.items?.length || 0} queue item(s)`);
  } else if (queueLoadError) {
    add('queue.json parse', 'fail', `${queueLoadError.filePath || 'queue.json'} - ${queueLoadError.detail}`);
  } else {
    add('queue.json parse', 'warn', 'No readable queue loaded yet.');
  }

  const sessionIssues = input.sessionStoreIssues || [];
  if (sessionIssues.length > 0) {
    const first = sessionIssues.slice(0, 3).map(issue => `${issue.kind}: ${issue.filePath} - ${issue.detail}`).join('; ');
    add('Session store integrity', 'warn', `${sessionIssues.length} issue(s): ${first}${sessionIssues.length > 3 ? `; and ${sessionIssues.length - 3} more` : ''}`);
  } else {
    add('Session store integrity', 'pass', 'Saved session and stats files are readable.');
  }

  add('Dispatch model setting', /^[A-Za-z0-9._:@/\-[\]]+$/.test(input.dispatchModel) ? 'pass' : 'fail', input.dispatchModel);
  return checks;
}

export function buildDoctorReachabilityTargets(input: DoctorChecksInput, manifest: IntegrationManifest | undefined = readIntegrationManifest().manifest): ProviderReachabilityTarget[] {
  const env = input.env || process.env;
  return [
    reachabilityTarget(
      'Jira network reachability',
      input.profile.providers.jira,
      firstConfiguredUrl(
        env['JIRA_BASE_URL'],
        manifest?.providers?.['jira']?.baseUrl,
        firstProjectConfigValue(input.state, ['jira_base_url', 'jira_url']),
      ),
    ),
    reachabilityTarget(
      'GitLab network reachability',
      input.profile.providers.gitlab,
      firstConfiguredUrl(
        env['GITLAB_BASE_URL'],
        env['GITLAB_URL'],
        env['GITLAB_HOST'],
        manifest?.providers?.['gitlab']?.baseUrl,
        firstProjectConfigValue(input.state, ['gitlab_base_url', 'gitlab_url']),
      ),
    ),
    reachabilityTarget(
      'Jenkins network reachability',
      input.profile.providers.jenkins,
      firstConfiguredUrl(
        env['JENKINS_URL'],
        manifest?.providers?.['jenkins']?.baseUrl,
        firstProjectConfigValue(input.state, ['jenkins_url', 'jenkins_base_url']),
      ),
    ),
    reachabilityTarget(
      'SonarQube network reachability',
      input.profile.providers.sonar,
      firstConfiguredUrl(
        env['SONAR_HOST_URL'],
        manifest?.providers?.['sonar']?.baseUrl,
        firstProjectConfigValue(input.state, ['sonar_host_url', 'sonar_url']),
      ),
    ),
    reachabilityTarget(
      'GitHub API network reachability',
      input.profile.providers.githubActions,
      firstConfiguredUrl(
        env['GITHUB_API_URL'],
        manifest?.providers?.['github']?.baseUrl,
        firstProjectConfigValue(input.state, ['github_api_url']),
        'https://api.github.com',
      ),
    ),
  ];
}

function reachabilityTarget(name: string, enabled: boolean, url: string | undefined): ProviderReachabilityTarget {
  const target: ProviderReachabilityTarget = { name, enabled };
  if (url) { target.url = url; }
  return target;
}

export async function runDoctorReachabilityChecks(input: DoctorChecksInput, options: ProviderReachabilityOptions = { timeoutMs: 5000 }): Promise<DoctorCheck[]> {
  try {
    const results = await probeProviderReachability(buildDoctorReachabilityTargets(input), options);
    return results.map(result => ({
      name: result.name,
      status: result.status,
      detail: result.detail,
    }));
  } catch (e: unknown) {
    return [{
      name: 'Provider network reachability',
      status: 'fail',
      detail: unknownErrorMessage(e, 'Provider reachability checks failed.'),
    }];
  }
}

export function projectConfigGaps(state: KronosState | null, profile: KronosProfile): string[] {
  const gaps: string[] = [];
  for (const [name, project] of Object.entries(state?.projects || {})) {
    const config = project.config || {};
    if (!config.base_branch && !config.default_branch) {
      gaps.push(`${name}: missing base/default branch`);
    }
    if (profile.providers.gitlab && !config.gitlab_project_id) {
      gaps.push(`${name}: missing gitlab_project_id`);
    }
    if (profile.providers.jenkins && !config.jenkins_url) {
      gaps.push(`${name}: missing jenkins_url`);
    }
    if (profile.providers.sonar && !config.sonar_project_key) {
      gaps.push(`${name}: missing sonar_project_key`);
    }
    if (profile.providers.githubActions && !config.github_repository && !config.github_repo) {
      gaps.push(`${name}: missing github_repository`);
    }
  }
  return gaps;
}

function commandCheck(checks: DoctorCheck[], commandRunner: DoctorCommandRunner, name: string, command: string, args: string[] = ['--version']): void {
  try {
    const out = commandRunner(command, args, { timeoutMs: COMMAND_TIMEOUT_MS }).trim();
    checks.push({ name, status: 'pass', detail: out.split('\n')[0] || `${command} available` });
  } catch (e: unknown) {
    checks.push({ name, status: 'fail', detail: unknownErrorMessage(e, `${command} unavailable`) });
  }
}

function claudeVersionCheck(checks: DoctorCheck[], commandRunner: DoctorCommandRunner): void {
  try {
    const claudeVersion = commandRunner('claude', ['--version'], { timeoutMs: COMMAND_TIMEOUT_MS }).trim().split('\n')[0] || 'claude available';
    checks.push({ name: 'Claude CLI compatible version', status: /\d/.test(claudeVersion) ? 'pass' : 'warn', detail: claudeVersion });
  } catch (e: unknown) {
    checks.push({ name: 'Claude CLI compatible version', status: 'fail', detail: unknownErrorMessage(e, 'claude unavailable') });
  }
}

function credentialCheck(checks: DoctorCheck[], env: Record<string, string | undefined>, name: string, enabled: boolean, vars: string[]): void {
  if (!enabled) {
    checks.push({ name, status: 'pass', detail: 'Provider disabled by active profile' });
    return;
  }
  const present = vars.filter(key => Boolean(env[key]));
  const missing = vars.filter(key => !env[key]);
  checks.push({
    name,
    status: missing.length === 0 ? 'pass' : 'warn',
    detail: `${present.length}/${vars.length} configured${missing.length ? `; missing ${missing.join(', ')}` : ''}. Values are not displayed.`,
  });
}

function credentialAnyCheck(checks: DoctorCheck[], env: Record<string, string | undefined>, name: string, enabled: boolean, vars: string[]): void {
  if (!enabled) {
    checks.push({ name, status: 'pass', detail: 'Provider disabled by active profile' });
    return;
  }
  const present = vars.filter(key => Boolean(env[key]));
  checks.push({
    name,
    status: present.length > 0 ? 'pass' : 'warn',
    detail: present.length > 0
      ? `1 credential source configured. Values are not displayed.`
      : `Missing one of ${vars.join(', ')}. Values are not displayed.`,
  });
}

function firstConfiguredUrl(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0);
}

function firstProjectConfigValue(state: KronosState | null, keys: string[]): string | undefined {
  for (const project of Object.values(state?.projects || {})) {
    const config = (project.config || {}) as Record<string, unknown>;
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  }
  return undefined;
}

function defaultCommandRunner(command: string, args: string[], options: DoctorCommandOptions): string {
  return defaultCliProbeCommandRunner(command, args, {
    timeoutMs: options.timeoutMs,
    maxBuffer: MAX_COMMAND_BUFFER,
  });
}
