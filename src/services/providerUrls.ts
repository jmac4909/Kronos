export type ProviderUrlProvider = 'jira' | 'gitlab' | 'jenkins' | 'sonar';

const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
const SONAR_PROJECT_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,400}$/;
const MAX_PROVIDER_URL_CHARS = 8_192;
const MAX_SONAR_BRANCH_CHARS = 1_000;

/**
 * Normalizes a browser-facing provider URL without retaining credentials.
 * SonarQube dashboard routing requires its id and branch query parameters;
 * every other query parameter and every fragment is discarded.
 */
export function normalizeProviderPublicUrl(
  value: unknown,
  provider: ProviderUrlProvider,
): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROVIDER_URL_CHARS || CONTROL_PATTERN.test(trimmed)) { return undefined; }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    const sonarProjectKey = provider === 'sonar' ? url.searchParams.get('id')?.trim() : undefined;
    const sonarBranch = provider === 'sonar' ? url.searchParams.get('branch')?.trim() : undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    if (sonarProjectKey
      && SONAR_PROJECT_KEY_PATTERN.test(sonarProjectKey)
      && redactSensitiveTokens(sonarProjectKey) === sonarProjectKey) {
      url.searchParams.set('id', sonarProjectKey);
    }
    if (sonarBranch
      && sonarBranch.length <= MAX_SONAR_BRANCH_CHARS
      && !CONTROL_PATTERN.test(sonarBranch)
      && redactSensitiveTokens(sonarBranch) === sonarBranch) {
      url.searchParams.set('branch', sonarBranch);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
import { redactSensitiveTokens } from './sensitiveText';
