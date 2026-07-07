export interface KronosState {
  version: number;
  last_updated: string | null;
  settings: KronosSettings;
  projects: Record<string, Project>;
  tickets: Record<string, Ticket>;
  adhoc_tasks: Record<string, AdhocTask>;
  overnight: OvernightState;
  discovered_projects: DiscoveredProject[];
}

interface KronosSettings {
  scan_dirs: string[];
  jira_project_key?: string;
  overnight: OvernightSettings;
}

interface OvernightSettings {
  enabled: boolean;
  max_concurrent: number;
  max_open_mrs_per_project: number;
  nightly_implement_cap: number;
  vpn_check_host: string;
  vpn_check_port: number;
  vpn_check_interval_sec: number;
}

export interface Project {
  path: string;
  priority: number;
  config: ProjectConfig;
  health: 'green' | 'yellow' | 'red' | 'gray';
  summary: string;
  last_polled: string | null;
  open_mr_count: number;
}

export interface ProjectConfig {
  repo_name?: string;
  jira_project_key?: string;
  jira_ticket_filter?: string;
  gitlab_project_id?: number;
  jenkins_url?: string;
  sonar_project_key?: string;
  github_repository?: string;
  github_repo?: string;
  github_api_url?: string;
  base_branch?: string;
  default_branch?: string;
  deploy_approvers?: Array<{ name: string; id: string; email: string }>;
  extra_dirs?: string[];
}

export interface Ticket {
  summary: string;
  type: string;
  priority: string;
  jira_status: string;
  source: 'jira' | 'adhoc';
  updated?: string;
  description?: string;
  labels?: string[];
  fixVersion?: string | { name?: string };
  fixVersions?: Array<string | { name?: string }>;
  release?: string | { name?: string };
  milestone?: string | { name?: string };
  sprint?: string | { name?: string };
  attachments?: Array<{ filename: string; size: number; mimeType: string }>;
  jira_url?: string;
  projects: string[];
  mr: MergeRequest | null;
  build: BuildStatus | null;
  next_action: string;
  last_action: string | null;
  last_action_at: string | null;
  evidence?: TicketEvidence;
}

export interface TicketEvidence {
  updated_at?: string;
  notes?: TicketEvidenceNote[];
  acceptance_criteria?: TicketAcceptanceCriterion[];
  acceptance_criteria_status?: 'extracted' | 'none';
  acceptance_criteria_extracted_at?: string;
  checks?: TicketEvidenceCheck[];
  environment_results?: Record<string, TicketEnvironmentResult>;
  risk_notes?: TicketEvidenceRiskNote[];
}

export interface TicketEvidenceNote {
  at: string;
  kind: 'note' | 'test' | 'risk' | 'decision';
  text: string;
}

export interface TicketEvidenceCheck {
  id: string;
  at: string;
  name: string;
  result: 'pass' | 'fail' | 'warn' | 'unknown';
  command?: string;
  environment?: string;
  artifact_path?: string;
  confidence?: 'low' | 'medium' | 'high';
  summary?: string;
}

export interface TicketEnvironmentResult {
  environment: string;
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  checked_at: string;
  detail: string;
  artifact_path?: string;
}

interface TicketEvidenceRiskNote {
  at: string;
  text: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface TicketAcceptanceCriterion {
  id: string;
  text: string;
  checked?: boolean;
  source?: 'description' | 'manual';
}

export interface MergeRequest {
  iid: number;
  state: 'opened' | 'merged' | 'closed';
  review_status: 'pending_review' | 'approved' | 'changes_requested';
  url: string;
  title?: string;
  author?: string;
  comment_count?: number;
  last_comment_at?: string;
  comments?: MergeRequestComment[];
  discussion_count?: number;
  unresolved_discussion_count?: number;
  resolved_discussion_count?: number;
  last_discussion_at?: string;
  discussions_resolved?: boolean;
  source_branch?: string;
  target_branch?: string;
  sourceBranch?: string;
  targetBranch?: string;
  branch?: string;
  head_branch?: string;
  files?: MergeRequestChangedFile[];
  changed_files?: MergeRequestChangedFile[];
}

export interface MergeRequestComment {
  id?: string;
  author?: string;
  created?: string;
  body: string;
}

export interface MergeRequestChangedFile {
  path?: string;
  new_path?: string;
  old_path?: string;
  newPath?: string;
  oldPath?: string;
  file?: string;
  filename?: string;
  diff?: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
}

interface BuildStatus {
  number: number;
  status: string;
  url: string;
}

export interface AdhocTask {
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  projects: string[];
  created_at: string;
  completed_at?: string;
}

interface OvernightState {
  enabled: boolean;
  last_run: OvernightRun | null;
}

interface OvernightRun {
  id: string;
  status: string;
  tickets_implemented?: number;
  vpn_drops?: number;
}

export interface DiscoveredProject {
  path: string;
  repo_name: string;
  has_project_json: boolean;
  git_remote: string | null;
  pom_artifact_id: string | null;
  suggested_jira_key: string | null;
}

export interface QueueState {
  items: QueueItem[];
  last_computed: string | null;
  decisions?: Record<string, QueueDecision>;
}

export interface QueueItem {
  id: string;
  ticket: string | null;
  ticket_summary?: string;
  projects: string[];
  project_path: string;
  action: string;
  priority_score: number;
  reason: string;
}

export interface QueueDecision {
  plan_id: string;
  ticket: string | null;
  action: string;
  decision: 'rejected' | 'snoozed';
  decided_at: string;
  reason?: string;
  snoozed_until?: string;
}

export interface ClaudeSession {
  pid: number;
  cwd: string;
  kind: string;
  startedAt: number;
  sessionId: string;
  status: string;
}
