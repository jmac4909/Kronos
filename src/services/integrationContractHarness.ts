import type { ScriptHealth } from './scriptClient';
import { requiredScripts } from './scriptClient';
import { countLabel } from './countLabels';

export type IntegrationContractCheckStatus = 'pass' | 'warn' | 'fail';

export interface IntegrationContractExpectation {
  id: string;
  script: string;
  requiresScript?: boolean;
  command: string;
  purpose: string;
  requiredText: string[];
}

export interface IntegrationContractCheck {
  id: string;
  script: string;
  command: string;
  purpose: string;
  status: IntegrationContractCheckStatus;
  detail: string;
}

export interface IntegrationContractReport {
  status: IntegrationContractCheckStatus;
  summary: string;
  checks: IntegrationContractCheck[];
}

export const INTEGRATION_CONTRACT_EXPECTATIONS: IntegrationContractExpectation[] = [
  {
    id: 'jira-rest-ticket-context',
    script: 'native Jira REST',
    requiresScript: false,
    command: 'GET /rest/api/3/issue/<ticket_key> plus paginated comments',
    purpose: 'Hydrate a private Jira context artifact for explicit insertion into an interactive terminal.',
    requiredText: [
      'GET /rest/api/3/issue/<ticket_key>?fields=*all&expand=names,schema',
      'GET /rest/api/3/issue/<ticket_key>/comment?startAt=<offset>&maxResults=100&orderBy=created',
    ],
  },
  {
    id: 'jira-ticket-comments',
    script: 'kronos_state.py',
    command: 'kronos_state.py --ticket-comments <ticket_key>',
    purpose: 'Load Jira comments for ticket detail and evidence review.',
    requiredText: ['--ticket-comments', 'comments'],
  },
  {
    id: 'gitlab-rest-mr-status',
    script: 'native GitLab REST',
    requiresScript: false,
    command: 'GET /api/v4/projects/<project_id>/merge_requests/<mr_iid> plus notes, discussions, and approvals',
    purpose: 'Poll MR state, review status, comments, and discussions.',
    requiredText: ['GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>', 'notes', 'discussions'],
  },
  {
    id: 'gitlab-rest-mr-diff',
    script: 'native GitLab REST',
    requiresScript: false,
    command: 'GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/diffs',
    purpose: 'Fetch changed files for review hints and diff panels.',
    requiredText: ['GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/diffs', 'files'],
  },
  {
    id: 'gitlab-rest-mr-branch',
    script: 'native GitLab REST',
    requiresScript: false,
    command: 'GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>',
    purpose: 'Resolve the source branch for verify/fix flows.',
    requiredText: ['source_branch', 'target_branch'],
  },
  {
    id: 'gitlab-rest-project-id',
    script: 'native GitLab REST',
    requiresScript: false,
    command: 'GET /api/v4/projects/<namespace%2Fproject>',
    purpose: 'Resolve stable GitLab numeric project IDs for registered repos.',
    requiredText: ['GET /api/v4/projects/<namespace%2Fproject>', 'id'],
  },
  {
    id: 'jenkins-rest-build-status',
    script: 'native Jenkins REST',
    requiresScript: false,
    command: 'GET <jenkins_job_url>/api/json',
    purpose: 'Poll Jenkins build state for review and deployment readiness.',
    requiredText: ['GET <jenkins_job_url>/api/json', 'lastBuild', 'lastCompletedBuild'],
  },
  {
    id: 'jenkins-rest-build-trigger',
    script: 'native Jenkins REST',
    requiresScript: false,
    command: 'POST <jenkins_job_url>/build or /buildWithParameters',
    purpose: 'Trigger Jenkins jobs without routing provider credentials through Python scripts.',
    requiredText: ['POST <jenkins_job_url>/build', 'POST <jenkins_job_url>/buildWithParameters'],
  },
  {
    id: 'sonar-project-key',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --find-sonar-key <project_name>',
    purpose: 'Discover SonarQube keys for registered projects.',
    requiredText: ['--find-sonar-key', 'sonar_project_key'],
  },
  {
    id: 'sonar-branches',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-branches <sonar_project_key>',
    purpose: 'List branch quality-gate candidates.',
    requiredText: ['--sonar-branches', 'branches'],
  },
  {
    id: 'sonar-gate',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-gate <sonar_project_key> --branch <branch>',
    purpose: 'Fetch quality gate status before and after fixes.',
    requiredText: ['--sonar-gate', '--branch'],
  },
  {
    id: 'sonar-measures',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-measures <sonar_project_key> --branch <branch>',
    purpose: 'Fetch measures for report context.',
    requiredText: ['--sonar-measures', '--branch'],
  },
  {
    id: 'sonar-issues',
    script: 'pipeline_monitor.py',
    command: 'pipeline_monitor.py --sonar-issues <sonar_project_key> --branch <branch>',
    purpose: 'Fetch actionable SonarQube issues for fix-sonar runs.',
    requiredText: ['--sonar-issues', '--branch'],
  },
];

export function buildIntegrationContractReport(input: {
  contractDocText?: string;
  scripts?: ScriptHealth[];
} = {}): IntegrationContractReport {
  const docText = input.contractDocText || '';
  const scripts = input.scripts || requiredScripts();
  const scriptByName = new Map(scripts.map(script => [script.name, script]));
  const checks = INTEGRATION_CONTRACT_EXPECTATIONS.map(expectation => {
    const missingText = expectation.requiredText.filter(text => !docText.includes(text));
    if (expectation.requiresScript !== false) {
      const script = scriptByName.get(expectation.script as ScriptHealth['name']);
      if (!script?.present) {
        return contractCheck(expectation, 'fail', `${expectation.script} is missing from the script bundle.`);
      }
    }
    if (missingText.length > 0) {
      return contractCheck(expectation, 'warn', `Contract docs are missing: ${missingText.join(', ')}.`);
    }
    return contractCheck(expectation, 'pass', expectation.requiresScript === false
      ? 'Native REST contract text is documented.'
      : 'Script is present and contract text is documented.');
  });
  const failures = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warn').length;
  const passes = checks.filter(check => check.status === 'pass').length;
  const status: IntegrationContractCheckStatus = failures > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass';
  return {
    status,
    summary: `${countLabel(passes, 'contract check')} passed, ${countLabel(warnings, 'warning')}, ${countLabel(failures, 'failure')}.`,
    checks,
  };
}

function contractCheck(
  expectation: IntegrationContractExpectation,
  status: IntegrationContractCheckStatus,
  detail: string,
): IntegrationContractCheck {
  return {
    id: expectation.id,
    script: expectation.script,
    command: expectation.command,
    purpose: expectation.purpose,
    status,
    detail,
  };
}
