import type { ProjectConfig } from '../state/types';
import type { AttentionEventPromptContext } from './attentionEventContextStore';
import type { ContextComposerEvidenceItem } from './contextComposerView';
import type { GitLabProviderContext } from './gitlabMergeRequestContext';
import type { JenkinsBuildContext } from './jenkinsRestClient';
import type { JiraTicketContext } from './jiraTicketContext';
import type { LocalEvidenceSearchEntry } from './localEvidenceSearch';
import type { OperationStageInput } from './operationStageOutcome';
import type { PromptLibrarySourceKind } from './promptLibrary';
import { isRecord } from './records';
import type { SonarBranchContext } from './sonarRestClient';

const PROMPT_LIBRARY_SOURCE_KIND_LABELS: Readonly<Record<PromptLibrarySourceKind, string>> = Object.freeze({
  local: 'Local file',
  remote: 'Remote',
  cache: 'Cached copy',
});

export function normalizeRuntimeTicketKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(normalized) ? normalized : undefined;
}

export function localEvidenceSearchIcon(kind: LocalEvidenceSearchEntry['kind']): string {
  if (kind === 'session') { return 'terminal'; }
  if (kind === 'ticket') { return 'issues'; }
  if (kind === 'project') { return 'repo'; }
  if (kind === 'provider') { return 'plug'; }
  if (kind === 'artifact') { return 'file-text'; }
  return 'history';
}

export function runtimeStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function projectTargetStringProperty(value: unknown, key: 'projectName' | 'projectPath'): string | undefined {
  const direct = runtimeStringProperty(value, key);
  if (direct || !isRecord(value)) { return direct; }
  return runtimeStringProperty(value['target'], key);
}

export function providerOpenChoices(value: unknown): Array<{ label: string; description?: string; url: string }> {
  if (!isRecord(value) || !Array.isArray(value['providerChoices'])) { return []; }
  const choices: Array<{ label: string; description?: string; url: string }> = [];
  for (const item of value['providerChoices'].slice(0, 100)) {
    if (!isRecord(item)) { continue; }
    const label = safeProjectName(item['label']);
    const description = safeProjectName(item['description']);
    const url = typeof item['url'] === 'string' && item['url'].length <= 8_192 ? item['url'].trim() : '';
    if (!label || !url) { continue; }
    choices.push({ label, ...(description ? { description } : {}), url });
  }
  return choices;
}

export function safeProjectName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
}

export function configuredProjectPollingEnabled(config: ProjectConfig): boolean {
  return Boolean(
    config.gitlab_project_id
      || config.gitlab_project_path
      || config.jenkins_url
      || config.sonar_project_key
      || config.branch_profiles?.some(profile => profile.jenkins_url || profile.sonar_project_key),
  );
}

export function sonarProjectKeySuggestion(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = safeProjectName(value);
    if (candidate && /^[A-Za-z0-9_.:-]{1,400}$/.test(candidate)) { return candidate; }
  }
  return undefined;
}

export function promptLibrarySourceKindLabel(sourceKind: PromptLibrarySourceKind): string {
  return PROMPT_LIBRARY_SOURCE_KIND_LABELS[sourceKind];
}

export function contextProviderReadStep(complete: boolean, detail: string): OperationStageInput {
  return { state: complete ? 'succeeded' : 'partial', detail };
}

export function contextSnapshotStep(complete: boolean): OperationStageInput {
  return {
    state: complete ? 'succeeded' : 'partial',
    detail: complete
      ? 'The normalized bounded evidence snapshot is complete.'
      : 'The normalized snapshot retains the last valid or available evidence plus explicit warnings.',
  };
}

export function attentionEventComposerEvidence(context: AttentionEventPromptContext): ContextComposerEvidenceItem[] {
  const event = context.event;
  const evidence: ContextComposerEvidenceItem[] = [{
    label: 'Exact retained transition',
    detail: [
      `Provider: ${context.provider}`,
      `Severity: ${context.severity}`,
      `Observed: ${event.at}`,
      context.projectName ? `Project: ${context.projectName}` : '',
      context.ticketKey ? `Jira: ${context.ticketKey}` : '',
    ].filter(Boolean).join(' • '),
  }];
  if (event.subject) {
    evidence.push({ label: 'Subject', detail: `${event.subject.kind}: ${event.subject.id}` });
  }
  if (event.before || event.after) {
    evidence.push({
      label: 'State change',
      detail: `${event.before?.state || 'not recorded'} → ${event.after?.state || 'not recorded'}`,
    });
  }
  const metadata = Object.entries(event.metadata || {}).slice(0, 16);
  if (metadata.length > 0) {
    evidence.push({
      label: 'Event details',
      detail: metadata.map(([key, value]) => `${key}: ${String(value)}`).join('\n'),
    });
  }
  return evidence;
}

export function jiraComposerEvidence(context: JiraTicketContext): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  const facts = [
    context.status ? `Status: ${context.status}` : '',
    context.priority ? `Priority: ${context.priority}` : '',
    context.assignee ? `Assignee: ${context.assignee}` : '',
    context.updated ? `Updated: ${context.updated}` : '',
  ].filter(Boolean).join(' • ');
  if (facts) { evidence.push({ label: 'Ticket facts', detail: facts }); }
  if (context.description) {
    evidence.push({ label: 'Description', detail: contextComposerPreview(context.description) });
  }
  for (const comment of context.comments.slice(-10).reverse()) {
    const label = [comment.author || 'Jira comment', comment.created || comment.updated || ''].filter(Boolean).join(' • ');
    evidence.push({ label, detail: contextComposerPreview(comment.body) });
  }
  return evidence;
}

export function gitLabComposerEvidence(context: GitLabProviderContext): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  const mergeRequest = context.mergeRequest;
  evidence.push({
    label: 'Merge request facts',
    detail: `${mergeRequest.state} • ${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}${mergeRequest.draft ? ' • draft' : ''}`,
  });
  if (mergeRequest.description) {
    evidence.push({ label: 'Description', detail: contextComposerPreview(mergeRequest.description) });
  }
  const discussionNotes = context.discussions
    .flatMap(discussion => discussion.notes.map(note => ({ note, resolved: discussion.resolved })))
    .slice(-6)
    .reverse();
  for (const { note, resolved } of discussionNotes) {
    const author = note.author?.name || note.author?.username || 'GitLab discussion';
    evidence.push({
      label: `${author}${resolved === false ? ' • unresolved' : resolved === true ? ' • resolved' : ''}${note.createdAt ? ` • ${note.createdAt}` : ''}`,
      detail: contextComposerPreview(note.body),
    });
  }
  for (const note of context.notes.slice(-6).reverse()) {
    const author = note.author?.name || note.author?.username || 'GitLab note';
    evidence.push({
      label: `${author}${note.createdAt ? ` • ${note.createdAt}` : ''}`,
      detail: contextComposerPreview(note.body),
    });
  }
  return evidence.slice(0, 20);
}

export function ciComposerEvidence(
  jenkins: JenkinsBuildContext | undefined,
  sonar: SonarBranchContext | undefined,
): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  if (jenkins) {
    const testSummary = jenkins.tests
      ? `${jenkins.tests.passCount} passed • ${jenkins.tests.failCount} failed • ${jenkins.tests.skipCount} skipped`
      : `test report ${jenkins.completeness.testReport}`;
    evidence.push({
      label: `Jenkins #${jenkins.build.number} • ${jenkins.build.status}`,
      detail: `${testSummary} • ${jenkins.stages?.length || 0} stages • fetched ${jenkins.fetchedAt}`,
    });
    for (const failedCase of jenkins.tests?.failedCases.slice(0, 8) || []) {
      evidence.push({
        label: `Failed test • ${failedCase.className ? `${failedCase.className}.` : ''}${failedCase.name}`,
        detail: contextComposerPreview(failedCase.errorDetails || failedCase.errorStackTrace || failedCase.status),
      });
    }
    for (const stage of (jenkins.stages || []).filter(stage => !['SUCCESS', 'NOT_BUILT'].includes(stage.status.toUpperCase())).slice(0, 8)) {
      evidence.push({ label: `Jenkins stage • ${stage.name}`, detail: stage.status });
    }
  }
  if (sonar) {
    evidence.push({
      label: `SonarQube • ${sonar.projectKey} • ${sonar.branch}`,
      detail: `Quality gate ${sonar.qualityGate.status} • ${sonar.issues.length} issues fetched • fetched ${sonar.fetchedAt}`,
    });
    if (sonar.measures.length > 0) {
      evidence.push({
        label: 'SonarQube measures',
        detail: sonar.measures.slice(0, 20).map(measure => `${measure.metric}: ${measure.value ?? measure.periodValue ?? 'unavailable'}`).join('\n'),
      });
    }
    for (const issue of sonar.issues.slice(0, 8)) {
      evidence.push({
        label: `SonarQube issue${issue.severity ? ` • ${issue.severity}` : ''}${issue.line ? ` • line ${issue.line}` : ''}`,
        detail: contextComposerPreview(issue.message),
      });
    }
  }
  return evidence.slice(0, 24);
}

export function contextComposerPreview(value: string, maxLength = 4_000): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}
