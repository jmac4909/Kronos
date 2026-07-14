import { isGitLabRestConfigured, normalizeGitLabApiBaseUrl } from './gitlabRestClient';
import { isJenkinsRestConfigured, normalizeJenkinsBaseUrl } from './jenkinsRestClient';
import { isJiraRestConfigured, normalizeJiraBaseUrl } from './jiraRestClient';
import { isSonarRestConfigured, normalizeSonarBaseUrl } from './sonarRestClient';

export type ProviderReadinessId = 'jira' | 'gitlab' | 'jenkins' | 'sonar';
export type ProviderReadinessState = 'ready' | 'missing' | 'invalid-needs-test';
export type CredentialPresence = 'present' | 'missing' | 'invalid-needs-test';

export interface ProviderReadiness {
  id: ProviderReadinessId;
  name: string;
  state: ProviderReadinessState;
  credentialPresence: CredentialPresence;
  configured: boolean;
  detail: string;
  nextAction: string;
}

/**
 * Returns one secret-free configuration model for Setup, Doctor, Projects, and
 * project integration UI. This checks local shape only; live polling remains
 * the authority for authentication, permissions, and reachability.
 */
export function providerReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Record<ProviderReadinessId, ProviderReadiness> {
  return {
    jira: jiraReadiness(env),
    gitlab: gitLabReadiness(env),
    jenkins: jenkinsReadiness(env),
    sonar: sonarReadiness(env),
  };
}

function jiraReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = nonEmpty(env['JIRA_BASE_URL']);
  const email = nonEmpty(env['JIRA_EMAIL']);
  const token = nonEmpty(env['JIRA_API_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['JIRA_BASE_URL'] : []),
    ...(!email ? ['JIRA_EMAIL'] : []),
    ...(!token ? ['JIRA_API_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'jira',
      'Jira REST',
      token ? 'present' : 'missing',
      `Missing ${missing.join(', ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeJiraBaseUrl(baseUrl) || !isJiraRestConfigured(env)) {
    return invalidReadiness('jira', 'Jira REST', 'The configured Jira URL or credential shape is invalid.');
  }
  return readyReadiness(
    'jira',
    'Jira REST',
    'present',
    'Configuration is present for bounded Jira reads; live refresh verifies authentication and permission.',
  );
}

function gitLabReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  );
  const token = nonEmpty(env['GITLAB_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['GitLab URL'] : []),
    ...(!token ? ['GITLAB_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'gitlab',
      'GitLab REST',
      token ? 'present' : 'missing',
      `Missing ${missing.join(' and ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeGitLabApiBaseUrl(baseUrl) || !isGitLabRestConfigured(env)) {
    return invalidReadiness('gitlab', 'GitLab REST', 'The configured GitLab URL or credential shape is invalid.');
  }
  return readyReadiness(
    'gitlab',
    'GitLab REST',
    'present',
    'Configuration is present for bounded merge-request and pipeline reads; live polling verifies access.',
  );
}

function jenkinsReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = nonEmpty(env['JENKINS_URL']);
  const username = firstNonEmpty(env['JENKINS_USER'], env['JENKINS_USERNAME']);
  const token = firstNonEmpty(env['JENKINS_API_TOKEN'], env['JENKINS_TOKEN']);
  if (!baseUrl) {
    return missingReadiness(
      'jenkins',
      'Jenkins REST',
      username || token ? 'invalid-needs-test' : 'missing',
      'Missing JENKINS_URL. Credentials are optional only when the server permits anonymous reads.',
    );
  }
  if (!normalizeJenkinsBaseUrl(baseUrl) || !isJenkinsRestConfigured(env)) {
    return invalidReadiness('jenkins', 'Jenkins REST', 'The configured Jenkins URL is invalid.');
  }
  if (Boolean(username) !== Boolean(token)) {
    return invalidReadiness(
      'jenkins',
      'Jenkins REST',
      'Only one Jenkins credential field is present; add the matching username or token, or clear both for anonymous reads.',
    );
  }
  const credentialPresence: CredentialPresence = username && token ? 'present' : 'missing';
  return readyReadiness(
    'jenkins',
    'Jenkins REST',
    credentialPresence,
    credentialPresence === 'present'
      ? 'URL and credential fields are present; live polling verifies authentication and permission.'
      : 'URL is present; credentials are missing and live polling must verify that anonymous reads are allowed.',
  );
}

function sonarReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = firstNonEmpty(env['SONAR_HOST_URL'], env['SONAR_URL']);
  const token = nonEmpty(env['SONAR_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['SonarQube URL'] : []),
    ...(!token ? ['SONAR_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'sonar',
      'SonarQube REST',
      token ? 'present' : 'missing',
      `Missing ${missing.join(' and ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeSonarBaseUrl(baseUrl) || !isSonarRestConfigured(env)) {
    return invalidReadiness('sonar', 'SonarQube REST', 'The configured SonarQube URL or credential shape is invalid.');
  }
  return readyReadiness(
    'sonar',
    'SonarQube REST',
    'present',
    'Configuration is present for bounded quality reads; live polling verifies authentication and permission.',
  );
}

function readyReadiness(
  id: ProviderReadinessId,
  name: string,
  credentialPresence: CredentialPresence,
  detail: string,
): ProviderReadiness {
  return {
    id,
    name,
    state: 'ready',
    credentialPresence,
    configured: true,
    detail: `${detail} Credential presence: ${credentialPresence}.`,
    nextAction: 'Run Doctor or Poll Now to verify live provider access.',
  };
}

function missingReadiness(
  id: ProviderReadinessId,
  name: string,
  credentialPresence: CredentialPresence,
  detail: string,
): ProviderReadiness {
  return {
    id,
    name,
    state: 'missing',
    credentialPresence,
    configured: false,
    detail: `${detail} Credential presence: ${credentialPresence}.`,
    nextAction: 'Open the private provider configuration, complete this provider, reload it, then run Doctor.',
  };
}

function invalidReadiness(id: ProviderReadinessId, name: string, detail: string): ProviderReadiness {
  return {
    id,
    name,
    state: 'invalid-needs-test',
    credentialPresence: 'invalid-needs-test',
    configured: false,
    detail: `${detail} Credential presence: invalid-needs-test; values are not shown.`,
    nextAction: 'Open the private provider configuration, correct this provider, reload it, then run Doctor.',
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = nonEmpty(value);
    if (normalized) { return normalized; }
  }
  return undefined;
}
