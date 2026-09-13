import { normalizeJenkinsJobUrl } from './jenkinsRestClient';

const MAX_GITLAB_PROJECT_PATH_LENGTH = 512;
const MAX_JENKINS_JOB_URL_LENGTH = 4_000;
const MAX_SONAR_PROJECT_KEY_LENGTH = 400;
const MAX_BRANCH_LENGTH = 500;

/** Canonical GitLab namespace/project identity accepted by project setup and persisted state. */
export function normalizeProjectGitLabPath(value: unknown): string | undefined {
  const candidate = normalizedSingleLine(value, MAX_GITLAB_PROJECT_PATH_LENGTH);
  return candidate && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(candidate)
    ? candidate
    : undefined;
}

/** Canonical credential-free Jenkins job URL; non-loopback plain HTTP fails closed. */
export function normalizeProjectJenkinsUrl(value: unknown): string | undefined {
  const candidate = normalizedSingleLine(value, MAX_JENKINS_JOB_URL_LENGTH);
  if (!candidate) { return undefined; }
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) { return undefined; }
    const normalized = normalizeJenkinsJobUrl(parsed.toString());
    if (!normalized) { return undefined; }
    const pathname = new URL(normalized).pathname.replace(/\/+$/, '');
    const jobStart = pathname.indexOf('/job/');
    if (jobStart < 0) { return undefined; }
    const prefix = pathname.slice(0, jobStart).toLowerCase();
    if (/(?:^|\/)(?:branch|view|blue|console|api)(?:\/|$)/.test(prefix)) { return undefined; }
    const jobPath = pathname.slice(jobStart);
    return /^\/job\/[^/]+(?:\/job\/[^/]+)*$/.test(jobPath)
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

/** Canonical SonarQube project identity accepted by project setup and persisted state. */
export function normalizeProjectSonarKey(value: unknown): string | undefined {
  const candidate = normalizedSingleLine(value, MAX_SONAR_PROJECT_KEY_LENGTH);
  return candidate && /^[A-Za-z0-9_.:-]+$/.test(candidate) ? candidate : undefined;
}

/** Conservative Git ref-name subset used for configured provider and target branches. */
export function normalizeProjectBranch(value: unknown): string | undefined {
  const branch = normalizedSingleLine(value, MAX_BRANCH_LENGTH);
  return branch
    && /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,499}$/.test(branch)
    && !branch.includes('..')
    && !branch.includes('@{')
    && !branch.includes('//')
    && !branch.endsWith('/')
    && !branch.endsWith('.')
    && !branch.endsWith('.lock')
    ? branch
    : undefined;
}

function normalizedSingleLine(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}
