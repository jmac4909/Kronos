const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultDir = path.join(root, '.kronos', 'feedback-state');

function fail(message) {
  console.error(`Feedback state failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { targetDir: defaultDir, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--dir') {
      const value = argv[index + 1];
      if (!value) { fail('--dir requires a path'); }
      options.targetDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/create-feedback-state.js [--dir <path>] [--force]');
      process.exit(0);
    }
    fail(`unknown argument: ${argument}`);
  }
  return options;
}

function assertSafeTarget(targetDir) {
  const resolved = path.resolve(targetDir);
  const homeKronos = path.join(os.homedir(), '.kronos');
  if (resolved === homeKronos || !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    fail('the feedback fixture must stay in this repository and cannot replace ~/.kronos');
  }
  return resolved;
}

function writePrivate(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  if (process.platform !== 'win32') { fs.chmodSync(filePath, 0o600); }
}

function fixture(now, targetDir) {
  const projectPath = path.join(targetDir, 'fixture-repo');
  return {
    schemaVersion: 1,
    refreshedAt: now,
    projects: {
      'fixture-service': {
        path: projectPath,
        config: {
          repo_name: 'fixture-service',
          jira_project_key: 'JIRA',
          gitlab_project_id: 1001,
          jenkins_url: 'https://jenkins.example.invalid/job/fixture-service',
          sonar_project_key: 'fixture-service',
          default_branch: 'main',
        },
      },
    },
    tickets: {
      'JIRA-123': {
        summary: 'Terminal-owned session with linked MR and build',
        type: 'Story',
        priority: 'High',
        jira_status: 'In Review',
        source: 'jira',
        updated: now,
        description: 'Use this ticket to evaluate Manage Focused Terminal and explicit context insertion.',
        labels: ['terminal-first', 'safe-fixture'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-123',
        projects: ['fixture-service'],
        mr: {
          iid: 77,
          state: 'opened',
          review_status: 'pending_review',
          url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/77',
          title: 'Terminal-first fixture MR',
          source_branch: 'feature/jira-123',
          target_branch: 'main',
          unresolved_discussion_count: 1,
        },
        build: {
          number: 142,
          status: 'SUCCESS',
          url: 'https://jenkins.example.invalid/job/fixture-service/142',
        },
      },
      'JIRA-456': {
        summary: 'Attention-state fixture with requested changes',
        type: 'Bug',
        priority: 'Critical',
        jira_status: 'In Progress',
        source: 'jira',
        updated: now,
        description: 'Provider URLs intentionally use .invalid and must never be mutated.',
        labels: ['terminal-first', 'needs-attention'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-456',
        projects: ['fixture-service'],
        mr: {
          iid: 78,
          state: 'opened',
          review_status: 'changes_requested',
          url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/78',
          source_branch: 'fix/jira-456',
          target_branch: 'main',
          unresolved_discussion_count: 2,
        },
        build: {
          number: 143,
          status: 'FAILURE',
          url: 'https://jenkins.example.invalid/job/fixture-service/143',
        },
      },
      'JIRA-789': {
        summary: 'Completed unlinked Jira work item',
        type: 'Task',
        priority: 'Medium',
        jira_status: 'Done',
        jira_status_category: 'done',
        source: 'jira',
        updated: now,
        description: 'Use this row to verify completed filtering and graceful unavailable-provider states.',
        labels: ['terminal-first', 'unlinked', 'completed-fixture'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-789',
        projects: [],
        mr: null,
        build: null,
      },
    },
  };
}

const options = parseArgs(process.argv.slice(2));
const targetDir = assertSafeTarget(options.targetDir);
if (fs.existsSync(targetDir)) {
  if (!options.force) { fail(`${targetDir} already exists; pass --force to replace this fixture only`); }
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
const now = new Date().toISOString();
const state = fixture(now, targetDir);
writePrivate(path.join(targetDir, 'work.json'), `${JSON.stringify(state, null, 2)}\n`);
writePrivate(path.join(targetDir, 'fixture-repo', 'README.md'), '# Kronos terminal-first feedback fixture\n\nNo provider or project command should run here.\n');
writePrivate(path.join(targetDir, '.env.example'), [
  '# Copy only to a private test location and provide non-production values.',
  'JIRA_BASE_URL=https://jira.example.invalid',
  'JIRA_EMAIL=',
  'JIRA_API_TOKEN=',
  'JIRA_JQL=project = JIRA ORDER BY updated DESC',
  '',
].join('\n'));

console.log('Kronos terminal-first feedback state created.');
console.log(`KRONOS_DIR=${targetDir}`);
console.log(`Work catalog: ${path.join(targetDir, 'work.json')}`);
