type KronosProfileId = 'personal-local' | 'enterprise-gitlab-jira' | 'github-actions' | 'no-sonar';

export interface KronosProfile {
  id: KronosProfileId;
  label: string;
  description: string;
  defaultBaseBranch: string;
  providers: {
    jira: boolean;
    gitlab: boolean;
    jenkins: boolean;
    sonar: boolean;
    githubActions: boolean;
  };
}

const DEFAULT_PROFILE: KronosProfile = {
    id: 'enterprise-gitlab-jira',
    label: 'Enterprise GitLab + Jira',
    description: 'Jira tickets, GitLab MRs, Jenkins builds, and SonarQube gates.',
    defaultBaseBranch: 'develop',
    providers: { jira: true, gitlab: true, jenkins: true, sonar: true, githubActions: false },
};

export const BUILTIN_PROFILES: KronosProfile[] = [
  DEFAULT_PROFILE,
  {
    id: 'personal-local',
    label: 'Personal Local',
    description: 'Local repositories with minimal external integration assumptions.',
    defaultBaseBranch: 'main',
    providers: { jira: false, gitlab: false, jenkins: false, sonar: false, githubActions: false },
  },
  {
    id: 'github-actions',
    label: 'GitHub Actions',
    description: 'GitHub-oriented projects with Actions as the build provider.',
    defaultBaseBranch: 'main',
    providers: { jira: false, gitlab: false, jenkins: false, sonar: false, githubActions: true },
  },
  {
    id: 'no-sonar',
    label: 'No Sonar',
    description: 'Jira/GitLab/Jenkins workflow without SonarQube checks.',
    defaultBaseBranch: 'develop',
    providers: { jira: true, gitlab: true, jenkins: true, sonar: false, githubActions: false },
  },
];

export function listProfiles(): KronosProfile[] {
  return BUILTIN_PROFILES;
}

export function resolveProfile(profileId: string | undefined): KronosProfile {
  return BUILTIN_PROFILES.find(profile => profile.id === profileId) || DEFAULT_PROFILE;
}

export function resolveDefaultBaseBranch(profileId: string | undefined, configuredBranch?: string): string {
  const explicit = sanitizeBranch(configuredBranch || '');
  if (explicit) { return explicit; }
  return resolveProfile(profileId).defaultBaseBranch;
}

export function sanitizeBranch(branch: string): string | undefined {
  const trimmed = branch.trim().replace(/^origin\//, '');
  if (!trimmed) { return undefined; }
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed) || trimmed.includes('..') || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return undefined;
  }
  return trimmed;
}
