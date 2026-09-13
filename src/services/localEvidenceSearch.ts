import type { MonitorEvent } from './monitorEventStore';
import type { LocalProjectSummary } from './projectCatalog';
import { workSessionDisplayName, type WorkSessionRecord } from './workSessionStore';

export type LocalEvidenceSearchAction =
  | { kind: 'session'; sessionId: string }
  | { kind: 'ticket'; ticketKey: string; sessionId: string }
  | { kind: 'project'; projectName: string; projectPath: string }
  | { kind: 'provider'; sessionId: string; url?: string }
  | { kind: 'artifact'; sessionId: string; promptPath: string }
  | { kind: 'event'; sessionId: string };

export type LocalEvidenceSearchKind = 'session' | 'ticket' | 'project' | 'provider' | 'artifact' | 'event';

export interface LocalEvidenceSearchEntry {
  id: string;
  kind: LocalEvidenceSearchKind;
  label: string;
  description: string;
  detail: string;
  action: LocalEvidenceSearchAction;
}

export interface LocalEvidenceSearchInput {
  sessions: readonly WorkSessionRecord[];
  projects: readonly LocalProjectSummary[];
  events: readonly MonitorEvent[];
}

const MAX_PROJECTS = 200;
const MAX_SESSIONS = 200;
const MAX_TICKET_CONTEXTS = 300;
const MAX_PROVIDER_BINDINGS = 400;
const MAX_ARTIFACTS = 400;
const MAX_EVENTS = 500;

/**
 * Builds one ephemeral, rebuild-on-open metadata index. Terminal bindings are
 * deliberately not accepted as an index source, so input/output/scrollback
 * can never enter search through this service.
 */
export function buildLocalEvidenceSearchIndex(input: LocalEvidenceSearchInput): LocalEvidenceSearchEntry[] {
  const entries: LocalEvidenceSearchEntry[] = [];
  for (const project of input.projects.slice(0, MAX_PROJECTS)) {
    entries.push(entry({
      id: `project:${project.name}`,
      kind: 'project',
      label: project.displayName || project.name,
      description: project.branch
        ? `${project.detached ? 'detached' : 'branch'} ${project.branch}`
        : 'branch unavailable',
      detail: `${project.available ? 'registered project' : 'registered path unavailable'} • ${project.path}`,
      action: { kind: 'project', projectName: project.name, projectPath: project.path },
    }));
  }

  const sessions = input.sessions.slice(0, MAX_SESSIONS);
  for (const session of sessions) {
    const sessionName = workSessionDisplayName(session);
    entries.push(entry({
      id: `session:${session.id}`,
      kind: 'session',
      label: sessionName,
      description: [session.projectName || 'no project', session.status, session.kind].join(' • '),
      detail: session.ticketKeys.length > 0
        ? `Explicit Jira contexts: ${session.ticketKeys.join(', ')}`
        : 'No Jira context attached',
      action: { kind: 'session', sessionId: session.id },
    }));
  }

  let ticketCount = 0;
  for (const session of sessions) {
    const sessionName = workSessionDisplayName(session);
    for (const ticketKey of session.ticketKeys) {
      if (ticketCount >= MAX_TICKET_CONTEXTS) { break; }
      entries.push(entry({
        id: `ticket:${session.id}:${ticketKey}`,
        kind: 'ticket',
        label: ticketKey,
        description: `Explicit context in ${sessionName}`,
        detail: session.projectName ? `Project ${session.projectName}` : 'Session has no project',
        action: { kind: 'ticket', ticketKey, sessionId: session.id },
      }));
      ticketCount += 1;
    }
    if (ticketCount >= MAX_TICKET_CONTEXTS) { break; }
  }

  let providerCount = 0;
  for (const session of sessions) {
    const sessionName = workSessionDisplayName(session);
    for (const binding of session.providerBindings) {
      if (providerCount >= MAX_PROVIDER_BINDINGS) { break; }
      const action: LocalEvidenceSearchAction = { kind: 'provider', sessionId: session.id };
      if (binding.url) { action.url = binding.url; }
      entries.push(entry({
        id: `provider:${session.id}:${binding.id}`,
        kind: 'provider',
        label: `${providerLabel(binding.provider)} ${binding.resource}: ${binding.subjectId}`,
        description: session.projectName || sessionName,
        detail: [binding.projectId ? `provider project ${binding.projectId}` : '', `attached ${binding.attachedAt}`]
          .filter(Boolean).join(' • '),
        action,
      }));
      providerCount += 1;
    }
    if (providerCount >= MAX_PROVIDER_BINDINGS) { break; }
  }

  let artifactCount = 0;
  for (const session of sessions) {
    const sessionName = workSessionDisplayName(session);
    for (const artifact of session.artifacts) {
      if (artifactCount >= MAX_ARTIFACTS) { break; }
      entries.push(entry({
        id: `artifact:${session.id}:${artifact.id}`,
        kind: 'artifact',
        label: artifact.label,
        description: `${artifact.kind} • ${artifact.complete ? 'complete' : 'partial'} • ${sessionName}`,
        detail: `Fetched ${artifact.fetchedAt}${artifact.contentSha256 ? ` • SHA ${artifact.contentSha256.slice(0, 12)}` : ''}`,
        action: { kind: 'artifact', sessionId: session.id, promptPath: artifact.promptPath },
      }));
      artifactCount += 1;
    }
    if (artifactCount >= MAX_ARTIFACTS) { break; }
  }

  for (const event of input.events.slice(0, MAX_EVENTS)) {
    entries.push(entry({
      id: `event:${event.id}`,
      kind: 'event',
      label: event.summary,
      description: `${providerLabel(event.source)} • ${event.type} • ${event.at}`,
      detail: [event.subject?.project, event.subject?.ticketKey, event.subject?.kind, event.subject?.id]
        .filter(Boolean).join(' • ') || `Session ${event.sessionId}`,
      action: { kind: 'event', sessionId: event.sessionId },
    }));
  }
  return entries;
}

function entry(value: LocalEvidenceSearchEntry): LocalEvidenceSearchEntry {
  return {
    ...value,
    id: singleLine(value.id, 700),
    label: singleLine(value.label, 300),
    description: singleLine(value.description, 700),
    detail: singleLine(value.detail, 1_000),
  };
}

function singleLine(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function providerLabel(value: string): string {
  if (value === 'gitlab') { return 'GitLab'; }
  if (value === 'jenkins') { return 'Jenkins'; }
  if (value === 'sonar') { return 'SonarQube'; }
  if (value === 'jira') { return 'Jira'; }
  if (value === 'operator') { return 'Operator'; }
  if (value === 'kronos') { return 'Kronos'; }
  return singleLine(value, 100);
}
