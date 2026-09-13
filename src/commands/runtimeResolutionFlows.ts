import type { Ticket } from '../state/types';
import type { ContextBasketItem } from '../services/contextBasketStore';
import type { LocalEvidenceSearchEntry } from '../services/localEvidenceSearch';
import { localProjectPathKey, type LocalProjectSummary } from '../services/projectCatalog';
import { normalizeRuntimeTicketKey, projectTargetStringProperty, runtimeStringProperty } from '../services/runtimePresentation';
import { workSessionDisplayName, type WorkSessionRecord } from '../services/workSessionStore';

export interface RuntimeTicketChoice {
  label: string;
  description: string;
  detail: string;
  ticketKey: string;
}

export async function resolveRuntimeTicketKey(input: {
  argument: unknown;
  allowPick: boolean;
  tickets: Readonly<Record<string, Ticket>>;
  pick(items: readonly RuntimeTicketChoice[]): PromiseLike<RuntimeTicketChoice | undefined>;
  warn(message: string): void;
}): Promise<string | undefined> {
  const direct = normalizeRuntimeTicketKey(
    typeof input.argument === 'string'
      ? input.argument
      : runtimeStringProperty(input.argument, 'ticketKey') || runtimeStringProperty(input.argument, 'ticket'),
  );
  if (direct && input.tickets[direct]) { return direct; }
  if (!input.allowPick) { return undefined; }
  const entries = Object.entries(input.tickets);
  if (entries.length === 0) {
    input.warn('No Jira work is loaded. Refresh Work or run Kronos: Check Setup.');
    return undefined;
  }
  const pick = await input.pick(entries.map(([ticketKey, ticket]) => ({
    label: ticketKey,
    description: ticket.summary,
    detail: `${ticket.jira_status} • Jira ${ticket.jira_project_key || 'unknown'} • local ${ticket.linked_local_project || 'unlinked'}`,
    ticketKey,
  })));
  return pick?.ticketKey;
}

export interface RuntimeSessionChoice {
  label: string;
  description: string;
  detail: string;
  session: WorkSessionRecord;
}

export async function resolveRuntimeWorkSession(input: {
  argument: unknown;
  allowPick: boolean;
  readSession(id: string): WorkSessionRecord | null;
  sessionForTicket(ticketKey: string): WorkSessionRecord | null;
  listSessions(): WorkSessionRecord[];
  sessionLabel(session: WorkSessionRecord): string;
  pick(items: readonly RuntimeSessionChoice[]): PromiseLike<RuntimeSessionChoice | undefined>;
  logFailure(error: unknown): void;
}): Promise<WorkSessionRecord | undefined> {
  const direct = typeof input.argument === 'string'
    ? input.argument
    : runtimeStringProperty(input.argument, 'workSessionId') || runtimeStringProperty(input.argument, 'sessionId');
  if (direct) {
    try {
      const session = input.readSession(direct);
      if (session) { return session; }
    } catch (error: unknown) {
      input.logFailure(error);
    }
  }
  const ticketKey = normalizeRuntimeTicketKey(runtimeStringProperty(input.argument, 'ticketKey'));
  if (ticketKey) {
    const session = input.sessionForTicket(ticketKey);
    if (session) { return session; }
  }
  if (!input.allowPick) { return undefined; }
  const pick = await input.pick(input.listSessions().map(session => ({
    label: input.sessionLabel(session),
    description: session.kind === 'ticket'
      ? `${session.status} • ${session.monitoring.enabled ? 'monitoring on' : 'monitoring off'}`
      : `${session.status} • standalone`,
    detail: workSessionDisplayName(session),
    session,
  })));
  return pick?.session;
}

export interface RuntimeRegisteredProjectTarget {
  projectName: string;
  projectPath: string;
  displayName: string;
}

export interface RuntimeGitLabInsertionTarget {
  iid: number;
  projectIdOrPath: string;
  url?: string;
}

export interface RuntimeGitLabDiscoveryResult {
  match?: { iid: number; webUrl?: string };
  candidateCount: number;
  ambiguous: boolean;
}

export async function resolveRuntimeGitLabInsertionTarget(input: {
  ownerLabel: string;
  configuredProject: string | undefined;
  knownTarget: RuntimeGitLabInsertionTarget | undefined;
  sourceBranch: string | undefined;
  sessionActive: boolean;
  discover(request: {
    projectIdOrPath: string;
    ticketKey: string;
    sourceBranch?: string;
  }): PromiseLike<RuntimeGitLabDiscoveryResult>;
  bind(target: RuntimeGitLabInsertionTarget): void;
  refresh(): void;
  warn(message: string): void;
  log(error: unknown): void;
}): Promise<RuntimeGitLabInsertionTarget | undefined> {
  if (input.knownTarget) { return input.knownTarget; }
  if (!input.configuredProject) {
    input.warn(`${input.ownerLabel} needs a GitLab project ID or group/project path. Configure the linked project and Kronos will find its open merge request.`);
    return undefined;
  }
  let discovery: RuntimeGitLabDiscoveryResult;
  try {
    discovery = await input.discover({
      projectIdOrPath: input.configuredProject,
      ticketKey: input.ownerLabel,
      ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}),
    });
  } catch (error: unknown) {
    input.log(error);
    return undefined;
  }
  if (!discovery.match) {
    input.warn(discovery.ambiguous
      ? `${input.ownerLabel} has ${discovery.candidateCount} possible open merge requests. Kronos will not guess; use a unique ticket key in the title or description, or work from its source branch.`
      : `No unique open merge request matches ${input.ownerLabel}${input.sourceBranch ? ` or branch ${input.sourceBranch}` : ''} yet. GitLab polling will keep checking automatically.`);
    return undefined;
  }
  const target: RuntimeGitLabInsertionTarget = {
    iid: discovery.match.iid,
    projectIdOrPath: input.configuredProject,
    ...(discovery.match.webUrl ? { url: discovery.match.webUrl } : {}),
  };
  if (input.sessionActive) {
    input.bind(target);
    input.refresh();
  }
  return target;
}

export type RuntimeRegisteredProjectGitLabDiscovery =
  | { kind: 'unconfigured' }
  | { kind: 'failed'; detail: string; sourceBranch?: string }
  | { kind: 'ambiguous'; candidateCount: number; sourceBranch?: string }
  | { kind: 'not-found'; sourceBranch?: string }
  | { kind: 'matched'; target: RuntimeGitLabInsertionTarget; sourceBranch?: string };

export function presentRuntimeProjectGitLabInsertionTarget(input: {
  projectLabel: string;
  projectName: string;
  discovery: RuntimeRegisteredProjectGitLabDiscovery;
  warn(message: string): void;
  log(detail: string): void;
}): RuntimeGitLabInsertionTarget | undefined {
  const { discovery } = input;
  if (discovery.kind === 'matched') { return discovery.target; }
  if (discovery.kind === 'unconfigured') {
    input.warn(`${input.projectLabel} needs a GitLab project ID or group/project path before Kronos can find its merge request.`);
    return undefined;
  }
  if (discovery.kind === 'failed') {
    input.log(discovery.detail);
    input.warn(discovery.detail);
    return undefined;
  }
  input.warn(discovery.kind === 'ambiguous'
    ? `${input.projectLabel} has ${discovery.candidateCount} open merge requests for ${discovery.sourceBranch || 'the current project'}. Kronos will not guess or use an older saved merge request.`
    : `No unique open merge request matches ${discovery.sourceBranch ? `branch ${discovery.sourceBranch}` : input.projectLabel} yet. Project polling will keep checking automatically.`);
  return undefined;
}

export async function discoverRuntimeRegisteredProjectGitLabTarget(input: {
  configuredProject: string | undefined;
  sourceBranch: string | undefined;
  discover(request: { projectIdOrPath: string; sourceBranch?: string }): PromiseLike<RuntimeGitLabDiscoveryResult>;
  failureDetail(error: unknown): string;
  prepareOwner(): {
    knownTarget: RuntimeGitLabInsertionTarget | undefined;
    bind(target: RuntimeGitLabInsertionTarget): void;
  };
  refresh(): void;
}): Promise<RuntimeRegisteredProjectGitLabDiscovery> {
  if (!input.configuredProject) { return { kind: 'unconfigured' }; }
  let discovery: RuntimeGitLabDiscoveryResult;
  try {
    discovery = await input.discover({
      projectIdOrPath: input.configuredProject,
      ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}),
    });
  } catch (error: unknown) {
    return {
      kind: 'failed',
      detail: input.failureDetail(error),
      ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}),
    };
  }
  if (!discovery.match) {
    return discovery.ambiguous
      ? { kind: 'ambiguous', candidateCount: discovery.candidateCount, ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}) }
      : { kind: 'not-found', ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}) };
  }
  const target: RuntimeGitLabInsertionTarget = {
    iid: discovery.match.iid,
    projectIdOrPath: input.configuredProject,
    ...(discovery.match.webUrl ? { url: discovery.match.webUrl } : {}),
  };
  const owner = input.prepareOwner();
  if (!owner.knownTarget
    || owner.knownTarget.iid !== target.iid
    || owner.knownTarget.projectIdOrPath !== target.projectIdOrPath
    || (target.url && owner.knownTarget.url !== target.url)) {
    owner.bind(target);
    input.refresh();
  }
  return { kind: 'matched', target, ...(input.sourceBranch ? { sourceBranch: input.sourceBranch } : {}) };
}

export function resolveRuntimeRegisteredProject(
  argument: unknown,
  projects: readonly LocalProjectSummary[],
  warn: (message: string) => void,
): RuntimeRegisteredProjectTarget | undefined {
  const projectName = projectTargetStringProperty(argument, 'projectName');
  const projectPath = projectTargetStringProperty(argument, 'projectPath');
  const registered = (projectName ? projects.find(project => project.name === projectName) : undefined)
    || (projectPath ? projects.find(project =>
      localProjectPathKey(project.path) === localProjectPathKey(projectPath)
    ) : undefined);
  if (!registered) {
    warn('That Project row is stale or no longer registered. Refresh Projects or choose Manage Projects to register it.');
    return undefined;
  }
  return { projectName: registered.name, projectPath: registered.path, displayName: registered.displayName };
}

export async function refreshRuntimeContextBasketItem(input: {
  item: ContextBasketItem;
  projects: readonly LocalProjectSummary[];
  insertJira(ticketKey: string): PromiseLike<void>;
  insertGitLab(target: { ticketKey?: string; projectName?: string; projectPath?: string }): PromiseLike<void>;
  insertCi(target: { ticketKey?: string; projectName?: string; projectPath?: string }): PromiseLike<void>;
  insertGit(target: { projectName: string; projectPath: string }): PromiseLike<void>;
  warn(message: string): void;
}): Promise<void> {
  const { item } = input;
  if (item.refresh.kind === 'jira' && item.refresh.ticketKey) {
    await input.insertJira(item.refresh.ticketKey);
    return;
  }
  if ((item.refresh.kind === 'gitlab' || item.refresh.kind === 'ci') && item.refresh.ticketKey) {
    const target = { ticketKey: item.refresh.ticketKey };
    await (item.refresh.kind === 'gitlab' ? input.insertGitLab(target) : input.insertCi(target));
    return;
  }
  if ((item.refresh.kind === 'gitlab' || item.refresh.kind === 'ci' || item.refresh.kind === 'git')
    && item.refresh.projectName) {
    const project = input.projects.find(candidate => candidate.name === item.refresh.projectName);
    if (project) {
      const target = { projectName: project.name, projectPath: project.path };
      if (item.refresh.kind === 'gitlab') { await input.insertGitLab(target); }
      else if (item.refresh.kind === 'ci') { await input.insertCi(target); }
      else { await input.insertGit(target); }
      return;
    }
  }
  input.warn(`${item.label} no longer has a registered source target. Reopen it from Work or Projects.`);
}

export async function openRuntimeLocalEvidenceResult(input: {
  entry: LocalEvidenceSearchEntry;
  ticketLoaded(ticketKey: string): boolean;
  focusSession(sessionId: string): PromiseLike<void>;
  openTicket(ticketKey: string): PromiseLike<void>;
  openAudit(sessionId: string): PromiseLike<void>;
  openProject(target: { projectName: string; projectPath: string }): PromiseLike<void>;
  openArtifact(promptPath: string): PromiseLike<void>;
  openProvider(url: string): PromiseLike<void>;
  artifactUnavailable(error: unknown): void;
}): Promise<void> {
  const action = input.entry.action;
  if (action.kind === 'session') {
    await input.focusSession(action.sessionId);
    return;
  }
  if (action.kind === 'ticket') {
    if (input.ticketLoaded(action.ticketKey)) { await input.openTicket(action.ticketKey); }
    else { await input.openAudit(action.sessionId); }
    return;
  }
  if (action.kind === 'project') {
    await input.openProject({ projectName: action.projectName, projectPath: action.projectPath });
    return;
  }
  if (action.kind === 'artifact') {
    try { await input.openArtifact(action.promptPath); }
    catch (error: unknown) { input.artifactUnavailable(error); }
    return;
  }
  if (action.kind === 'provider' && action.url) {
    await input.openProvider(action.url);
    return;
  }
  await input.openAudit(action.sessionId);
}
