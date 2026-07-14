/** The small, provider-oriented catalog rendered by the terminal-first product. */
export interface KronosState {
  schemaVersion: 1;
  refreshedAt: string | null;
  projects: Record<string, Project>;
  tickets: Record<string, Ticket>;
}

export interface Project {
  path?: string;
  config: ProjectConfig;
}

export interface ProjectConfig {
  repo_name?: string;
  jira_project_key?: string;
  jira_ticket_filter?: string;
  gitlab_project_id?: number;
  gitlab_project_path?: string;
  jenkins_url?: string;
  sonar_project_key?: string;
  base_branch?: string;
  default_branch?: string;
  extra_dirs?: string[];
}

export interface Ticket {
  summary: string;
  type: string;
  priority: string;
  jira_status: string;
  /** Jira's status-category key/name, normally new, indeterminate, or done. */
  jira_status_category?: string;
  source: 'jira';
  updated?: string;
  description?: string;
  labels?: string[];
  attachments?: Array<{ filename: string; size: number; mimeType: string }>;
  jira_url?: string;
  /** Explicit local project used only as the starting directory for new ticket launches. */
  launch_project?: string;
  projects: string[];
  mr: MergeRequest | null;
  build: BuildStatus | null;
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
}

export interface BuildStatus {
  number: number;
  status: string;
  url: string;
}
