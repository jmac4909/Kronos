import { isGitLabRestConfigured, normalizeGitLabApiBaseUrl } from './gitlabRestClient';
import { isJenkinsRestConfigured, normalizeJenkinsBaseUrl } from './jenkinsRestClient';
import { isJiraRestConfigured, normalizeJiraBaseUrl } from './jiraRestClient';
import { firstNonEmptyString, optionalTrimmedStringFromUnknown } from './records';
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
  const baseUrl = optionalTrimmedStringFromUnknown(env['JIRA_BASE_URL']);
  const email = optionalTrimmedStringFromUnknown(env['JIRA_EMAIL']);
  const token = optionalTrimmedStringFromUnknown(env['JIRA_API_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['JIRA_BASE_URL'] : []),
    ...(!email ? ['JIRA_EMAIL'] : []),
    ...(!token ? ['JIRA_API_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'jira',
      'Jira',
      token ? 'present' : 'missing',
      `Missing ${missing.join(', ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeJiraBaseUrl(baseUrl) || !isJiraRestConfigured(env)) {
    return invalidReadiness('jira', 'Jira', 'The configured Jira URL or credential shape is invalid.');
  }
  return readyReadiness(
    'jira',
    'Jira',
    'present',
    'Configuration is ready. Refresh Jira to verify access.',
  );
}

function gitLabReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = firstNonEmptyString(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  );
  const token = optionalTrimmedStringFromUnknown(env['GITLAB_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['GitLab URL'] : []),
    ...(!token ? ['GITLAB_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'gitlab',
      'GitLab',
      token ? 'present' : 'missing',
      `Missing ${missing.join(' and ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeGitLabApiBaseUrl(baseUrl) || !isGitLabRestConfigured(env)) {
    return invalidReadiness('gitlab', 'GitLab', 'The configured GitLab URL or credential shape is invalid.');
  }
  return readyReadiness(
    'gitlab',
    'GitLab',
    'present',
    'Configuration is ready for merge request and pipeline updates. Check Updates verifies access.',
  );
}

function jenkinsReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = optionalTrimmedStringFromUnknown(env['JENKINS_URL']);
  const username = firstNonEmptyString(env['JENKINS_USER'], env['JENKINS_USERNAME']);
  const token = firstNonEmptyString(env['JENKINS_API_TOKEN'], env['JENKINS_TOKEN']);
  if (!baseUrl) {
    return missingReadiness(
      'jenkins',
      'Jenkins',
      username || token ? 'invalid-needs-test' : 'missing',
      'Missing JENKINS_URL. Credentials are optional only when the server permits anonymous reads.',
    );
  }
  if (!normalizeJenkinsBaseUrl(baseUrl) || !isJenkinsRestConfigured(env)) {
    return invalidReadiness('jenkins', 'Jenkins', 'The configured Jenkins URL is invalid.');
  }
  if (Boolean(username) !== Boolean(token)) {
    return invalidReadiness(
      'jenkins',
      'Jenkins',
      'Only one Jenkins credential field is present; add the matching username or token, or clear both for anonymous reads.',
    );
  }
  const credentialPresence: CredentialPresence = username && token ? 'present' : 'missing';
  return readyReadiness(
    'jenkins',
    'Jenkins',
    credentialPresence,
    credentialPresence === 'present'
      ? 'Configuration is ready for build updates. Check Updates verifies access.'
      : 'The URL is ready. Check Updates verifies whether anonymous reads are allowed.',
  );
}

function sonarReadiness(env: NodeJS.ProcessEnv): ProviderReadiness {
  const baseUrl = firstNonEmptyString(env['SONAR_HOST_URL'], env['SONAR_URL']);
  const token = optionalTrimmedStringFromUnknown(env['SONAR_TOKEN']);
  const missing = [
    ...(!baseUrl ? ['SonarQube URL'] : []),
    ...(!token ? ['SONAR_TOKEN'] : []),
  ];
  if (missing.length > 0) {
    return missingReadiness(
      'sonar',
      'SonarQube',
      token ? 'present' : 'missing',
      `Missing ${missing.join(' and ')}. Credential values are not shown.`,
    );
  }
  if (!normalizeSonarBaseUrl(baseUrl) || !isSonarRestConfigured(env)) {
    return invalidReadiness('sonar', 'SonarQube', 'The configured SonarQube URL or credential shape is invalid.');
  }
  return readyReadiness(
    'sonar',
    'SonarQube',
    'present',
    'Configuration is ready for quality updates. Check Updates verifies access.',
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
    nextAction: 'Check setup or choose Check Now to verify live provider access.',
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
    nextAction: 'Open the private provider configuration, complete this provider, reload it, then check setup.',
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
    nextAction: 'Open the private provider configuration, correct this provider, reload it, then check setup.',
  };
}
