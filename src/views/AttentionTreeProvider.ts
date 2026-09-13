import * as vscode from 'vscode';
import { boundedOperationFailure } from '../services/errorUtils';
import { formatDateTimeLabel } from '../services/dateLabels';
import {
  MonitorEvent,
  MonitorEventSource,
  listMonitorEvents,
} from '../services/monitorEventStore';
import {
  WorkSessionProviderBinding,
  WorkSessionRecord,
  listWorkSessions,
} from '../services/workSessionStore';
import {
  attentionProjectSessionForEvent,
  currentAttentionTransitions,
  type AttentionRegisteredProject,
} from '../services/attentionProjection';
import { normalizeProviderPublicUrl } from '../services/providerUrls';
import { providerBindingsForEvent } from '../services/providerBindingReconciliation';
import {
  activeAttentionProjectSortRank,
  activeAttentionProjectStateLabel,
  activeAttentionProjectStateSeverity,
  type ActiveAttentionProject,
  type ActiveAttentionProjectState,
} from '../services/activeAttentionMonitor';
import {
  attentionActionContext,
  attentionEventCanUsePromptContext,
  attentionEventPresentation,
  attentionProjectGroupIdentity,
  attentionProviderIconId,
  attentionProviderChoicesForEvent,
  attentionSeverity,
  attentionSeverityLabel,
  attentionSeverityColorId,
  attentionTicketKey,
  groupAttentionEntriesByProject,
  type AttentionProjectGroupIdentity,
  type AttentionProviderChoice,
} from '../services/attentionPresentation';

export interface AttentionCommandTarget {
  eventId: string;
  sessionId: string;
  workSessionId: string;
  ticketKey: string | undefined;
  source: MonitorEventSource;
  providerUrl: string | undefined;
  providerChoices?: AttentionProviderChoice[];
  projectName?: string;
  projectPath?: string;
}

export interface AttentionTreeProviderOptions {
  loadMonitorEvents?: () => MonitorEvent[];
  loadWorkSessions?: () => WorkSessionRecord[];
  loadRegisteredProjects?: () => readonly AttentionRegisteredProject[];
  loadProjectDisplayName?: (projectName: string) => string | undefined;
  loadActiveProjects?: () => readonly AttentionLiveProjectResult[];
}

export interface AttentionLiveProjectResult {
  projectName: string;
  projectPath: string;
  project: ActiveAttentionProject | null;
}

interface AttentionEntry {
  event: MonitorEvent;
  session: WorkSessionRecord | undefined;
  ticketKey: string | undefined;
  providerUrl: string | undefined;
  providerChoices: AttentionProviderChoice[];
  severity?: ReturnType<typeof attentionSeverity>;
  live?: boolean;
  dismissible?: boolean;
  projectState?: ActiveAttentionProjectState;
  checkedAt?: string;
}

/** Shows current project delivery work, with legacy transition fallback only outside registered ownership. */
export class AttentionTreeProvider implements vscode.TreeDataProvider<AttentionTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AttentionTreeItem | undefined>();
  private readonly loadMonitorEvents: () => MonitorEvent[];
  private readonly loadWorkSessions: () => WorkSessionRecord[];
  private readonly loadRegisteredProjects: () => readonly AttentionRegisteredProject[];
  private readonly loadProjectDisplayName: (projectName: string) => string | undefined;
  private readonly loadActiveProjects: (() => readonly AttentionLiveProjectResult[]) | undefined;
  private loadWarning = false;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(options: AttentionTreeProviderOptions = {}) {
    this.loadMonitorEvents = options.loadMonitorEvents
      ?? (() => listMonitorEvents({
        types: ['provider.transition', 'notification.acknowledged'],
        limit: 2000,
      }));
    this.loadWorkSessions = options.loadWorkSessions ?? (() => listWorkSessions());
    this.loadRegisteredProjects = options.loadRegisteredProjects ?? (() => []);
    this.loadProjectDisplayName = options.loadProjectDisplayName ?? (() => undefined);
    this.loadActiveProjects = options.loadActiveProjects;
  }

  getTreeItem(element: AttentionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AttentionTreeItem): AttentionTreeItem[] {
    if (element instanceof AttentionGroupTreeItem) {
      return element.entries.map(entry => new AttentionEventTreeItem(entry));
    }
    if (element) { return []; }

    this.loadWarning = false;
    const registeredProjects = this.safeLoadRegisteredProjects();
    const liveProjects = this.safeLoadActiveProjects();
    const coveredProjectNames = new Set([
      ...liveProjects.map(project => project.projectName),
      ...(this.loadActiveProjects ? registeredProjects.map(project => project.name) : []),
    ]);
    const liveEntries = liveProjects.flatMap(result => {
      const project = result.project;
      if (!project) { return []; }
      return project.rows.map(row => ({
        event: row.event,
        session: project.owner,
        ticketKey: attentionTicketKey(row.event, project.owner),
        providerUrl: row.providerUrl || providerUrlForEvent(row.event, project.owner),
        providerChoices: attentionProviderChoicesForEvent(row.event, project.owner),
        severity: row.severity,
        live: true,
        dismissible: row.dismissible,
        projectState: project.state,
        checkedAt: project.observedAt,
      }));
    });
    const entries = [
      ...liveEntries,
      ...this.unacknowledgedEntries(registeredProjects).filter(entry =>
        !entry.session?.projectName || !coveredProjectNames.has(entry.session.projectName)
      ),
    ];
    const warningItems = this.loadWarning ? [new AttentionMessageTreeItem('warning')] : [];
    if (entries.length === 0) {
      return warningItems.length > 0 ? warningItems : [new AttentionMessageTreeItem()];
    }

    const groups = groupAttentionEntriesByProject(entries)
      .map(group => new AttentionGroupTreeItem(
        group.entries,
        group.identity,
        group.identity.projectName ? this.loadProjectDisplayName(group.identity.projectName) : undefined,
      ))
      .sort((left, right) =>
        activeAttentionProjectSortRank(left.projectState || 'in-progress')
          - activeAttentionProjectSortRank(right.projectState || 'in-progress')
        || right.newestAt.localeCompare(left.newestAt)
        || left.labelText.localeCompare(right.labelText));
    return [...warningItems, ...groups];
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private unacknowledgedEntries(
    registeredProjects: readonly AttentionRegisteredProject[],
  ): AttentionEntry[] {
    let events: MonitorEvent[];
    try {
      events = this.loadMonitorEvents();
    } catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos attention refresh failed: ${boundedOperationFailure(error, 'Attention events could not be read.').display}`);
      return [];
    }

    const sessions = this.safeLoadWorkSessions();
    const sessionsById = new Map(sessions.map(session => [session.id, session]));
    return currentAttentionTransitions(events, sessions, registeredProjects)
      .map(event => {
        const session = attentionProjectSessionForEvent(
          event,
          sessionsById.get(event.sessionId),
          sessions,
          registeredProjects,
        );
        const providerChoices = attentionProviderChoicesForEvent(event, session);
        return {
          event,
          session,
          ticketKey: attentionTicketKey(event, session),
          providerUrl: providerUrlForEvent(event, session) || providerChoices[0]?.url,
          providerChoices,
        };
      })
      .sort((left, right) => right.event.at.localeCompare(left.event.at)
        || right.event.id.localeCompare(left.event.id));
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try {
      return this.loadWorkSessions();
    } catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos attention session correlation failed: ${boundedOperationFailure(error, 'Attention session state could not be read.').display}`);
      return [];
    }
  }

  private safeLoadRegisteredProjects(): readonly AttentionRegisteredProject[] {
    try {
      return this.loadRegisteredProjects();
    } catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos attention project correlation failed: ${boundedOperationFailure(error, 'Registered projects could not be read.').display}`);
      return [];
    }
  }

  private safeLoadActiveProjects(): readonly AttentionLiveProjectResult[] {
    if (!this.loadActiveProjects) { return []; }
    try {
      return this.loadActiveProjects();
    } catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos live Attention refresh failed: ${boundedOperationFailure(error, 'Current delivery status could not be read.').display}`);
      return [];
    }
  }
}

export type AttentionTreeItem = AttentionGroupTreeItem | AttentionEventTreeItem | AttentionMessageTreeItem;

export class AttentionGroupTreeItem extends vscode.TreeItem {
  readonly newestAt: string;
  readonly labelText: string;
  readonly projectName: string | undefined;
  readonly projectState: ActiveAttentionProjectState | undefined;

  constructor(
    readonly entries: readonly AttentionEntry[],
    identity?: AttentionProjectGroupIdentity,
    displayName?: string,
  ) {
    const newest = entries[0];
    if (!newest) { throw new Error('Attention groups require at least one event.'); }
    const group = identity || attentionProjectGroupIdentity(newest.session?.projectName);
    const projectName = group.projectName;
    const nicknameIdentity = projectName && displayName ? attentionProjectGroupIdentity(displayName) : undefined;
    const label = nicknameIdentity?.projectName ? nicknameIdentity.label : group.label;
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.newestAt = entries.reduce(
      (latest, entry) => (entry.checkedAt || entry.event.at).localeCompare(latest) > 0
        ? entry.checkedAt || entry.event.at
        : latest,
      newest.checkedAt || newest.event.at,
    );
    this.labelText = label;
    this.projectName = projectName;
    this.id = group.id;
    this.contextValue = 'attention_group';
    const liveState = entries.map(entry => entry.projectState).find((state): state is ActiveAttentionProjectState => Boolean(state));
    this.projectState = liveState;
    this.description = liveState
      ? `${activeAttentionProjectStateLabel(liveState)} • ${entries.length} item${entries.length === 1 ? '' : 's'} • checked ${displayTimestamp(this.newestAt)}`
      : `${entries.length} item${entries.length === 1 ? '' : 's'} • ${displayTimestamp(this.newestAt)}`;
    this.tooltip = [
      `Project: ${label}`,
      ...(liveState ? [`Overall: ${activeAttentionProjectStateLabel(liveState)}`] : []),
      `${entries.length} current item${entries.length === 1 ? '' : 's'}`,
      `${liveState ? 'Last checked' : 'Latest update'}: ${formatDateTimeLabel(this.newestAt, 'Unknown')}`,
      liveState ? 'Expand to monitor current delivery work.' : 'Expand to review provider changes.',
    ].join('\n');
    const stateSeverity = liveState ? activeAttentionProjectStateSeverity(liveState) : undefined;
    this.iconPath = stateSeverity
      ? new vscode.ThemeIcon('pulse', new vscode.ThemeColor(attentionSeverityColorId(stateSeverity)))
      : new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.yellow'));
  }
}

export class AttentionEventTreeItem extends vscode.TreeItem implements AttentionCommandTarget {
  readonly eventId: string;
  readonly sessionId: string;
  readonly workSessionId: string;
  readonly ticketKey: string | undefined;
  readonly source: MonitorEventSource;
  readonly providerUrl: string | undefined;
  readonly providerChoices: AttentionProviderChoice[];
  readonly projectName?: string;
  readonly projectPath?: string;

  constructor(readonly entry: AttentionEntry) {
    const basePresentation = attentionEventPresentation(entry.event, entry.session);
    const presentation = entry.severity && entry.severity !== basePresentation.severity
      ? {
        ...basePresentation,
        severity: entry.severity,
        description: [
          basePresentation.provider,
          attentionSeverityLabel(entry.severity),
          displayTimestamp(basePresentation.changedAt),
        ].join(' • '),
      }
      : basePresentation;
    super(presentation.why, vscode.TreeItemCollapsibleState.None);
    this.eventId = entry.event.id;
    this.sessionId = entry.event.sessionId;
    this.workSessionId = entry.event.sessionId;
    this.ticketKey = entry.ticketKey;
    this.source = entry.event.source;
    this.providerUrl = entry.providerUrl;
    this.providerChoices = [...entry.providerChoices];
    if (entry.session?.projectName) { this.projectName = entry.session.projectName; }
    if (entry.session?.projectPath) { this.projectPath = entry.session.projectPath; }
    const target: AttentionCommandTarget = {
      eventId: this.eventId,
      sessionId: this.sessionId,
      workSessionId: this.workSessionId,
      ticketKey: this.ticketKey,
      source: this.source,
      providerUrl: this.providerUrl,
      ...(this.providerChoices.length > 1 ? { providerChoices: this.providerChoices } : {}),
      ...(this.projectName ? { projectName: this.projectName } : {}),
      ...(this.projectPath ? { projectPath: this.projectPath } : {}),
    };

    this.id = `attention-event:${entry.event.id}`;
    const baseActionContext = attentionActionContext(
      this.source,
      this.ticketKey,
      this.providerUrl,
      this.projectName,
    );
    const actionContext = entry.live
      ? `attention_live_${baseActionContext.slice('attention_'.length)}`
      : baseActionContext;
    const clearableActionContext = entry.dismissible ? `${actionContext}_clearable` : actionContext;
    this.contextValue = attentionEventCanUsePromptContext(entry.event)
      ? `${clearableActionContext}_event`
      : clearableActionContext;
    this.description = presentation.description;
    this.tooltip = eventTooltip(entry);
    this.iconPath = eventIcon(entry.event, presentation.severity);
    this.command = attentionPrimaryCommand(
      target,
      Boolean(entry.session?.projectName && entry.session.projectPath),
    );
  }
}

/** Keeps the row's only primary action inside the validated read/setup boundary. */
export function attentionPrimaryCommand(
  target: AttentionCommandTarget,
  hasProjectConfigurationTarget: boolean,
): vscode.Command {
  if (target.providerUrl) {
    return {
      command: 'kronos.openProvider',
      title: 'Open Provider Page',
      arguments: [target],
    };
  }
  if (hasProjectConfigurationTarget) {
    return {
      command: 'kronos.configureProjectIntegrations',
      title: 'Repair Provider Setup',
      arguments: [target],
    };
  }
  return {
    command: 'kronos.doctor',
    title: 'Check Setup',
  };
}

export class AttentionMessageTreeItem extends vscode.TreeItem {
  constructor(kind: 'empty' | 'warning' = 'empty') {
    super(kind === 'warning' ? 'Attention may be incomplete' : 'No active delivery work', vscode.TreeItemCollapsibleState.None);
    if (kind === 'warning') {
      this.contextValue = 'attention_error';
      this.description = 'Open Check Setup, then refresh';
      this.tooltip = 'Kronos could not load all saved provider updates. Select to open Check Setup.';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      this.command = { command: 'kronos.doctor', title: 'Check Setup' };
      return;
    }
    this.contextValue = 'attention_empty';
    this.tooltip = 'Projects appear while a merge request is open, a build is running, or an unresolved delivery problem needs review. Complete healthy work remains in Projects and local audit history.';
    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  }
}

function providerUrlForEvent(event: MonitorEvent, session: WorkSessionRecord | undefined): string | undefined {
  if (!isProviderUrlSource(event.source)) { return undefined; }
  const source = event.source;
  for (const binding of providerBindingsForEvent(event, session)) {
    const normalized = normalizeProviderPublicUrl(binding.url, source);
    if (normalized) { return normalized; }
  }
  return undefined;
}

function isProviderUrlSource(source: MonitorEventSource): source is WorkSessionProviderBinding['provider'] {
  return source === 'jira' || source === 'gitlab' || source === 'jenkins' || source === 'sonar';
}

function eventTooltip(entry: AttentionEntry): string {
  const event = entry.event;
  const presentation = attentionEventPresentation(event, entry.session);
  const primaryAction = attentionPrimaryActionLabel(entry);
  const lines = [
    presentation.why,
    `Project: ${presentation.project}`,
    ...(entry.ticketKey ? [`Jira ticket: ${entry.ticketKey}`] : []),
    `Provider: ${presentation.provider}`,
    `Subject: ${presentation.subject}`,
    `Status: ${attentionSeverityLabel(presentation.severity)}`,
    `Observed: ${formatDateTimeLabel(presentation.observedAt, 'Unknown')}`,
    `Last changed: ${formatDateTimeLabel(presentation.changedAt, 'Unknown')}`,
    `Select to ${primaryAction}.`,
    entry.live
      ? attentionEventCanUsePromptContext(event)
        ? entry.dismissible
          ? 'Use the inline X to clear this completed provider result locally, or right-click to use this exact retained event, review fresh context, and open history. A changed result appears again.'
          : 'Right-click to use this exact retained event, review fresh provider context, or open history. This current row cannot be cleared; running and pending CI stay visible.'
        : entry.dismissible
          ? 'Use the inline X to clear this completed provider result locally, or right-click for fresh provider context and history. A changed result appears again.'
          : 'Right-click for fresh provider context or history. This current row cannot be cleared; running and pending CI stay visible.'
      : attentionEventCanUsePromptContext(event)
        ? 'Right-click to use this exact event in a prompt, review broader context, open history, or Clear from Attention.'
        : 'Right-click for available context, history, and Clear from Attention.',
    ...(!entry.live ? [
      `After clearing: ${event.source === 'gitlab' && event.subject?.kind === 'merge-request' ? 'an open merge request returns after the next successful check; merged or closed requests stay cleared' : 'the item stays cleared until its state changes'}`,
    ] : []),
  ];
  for (const [key, label] of METADATA_TOOLTIP_FIELDS) {
    const value = event.metadata?.[key];
    if (value !== undefined && value !== null) { lines.push(`${label}: ${String(value)}`); }
  }
  return lines.join('\n');
}

function attentionPrimaryActionLabel(entry: AttentionEntry): string {
  if (entry.providerUrl) { return 'open the provider page'; }
  return entry.session?.projectName && entry.session.projectPath ? 'open project integrations' : 'check setup';
}

const METADATA_TOOLTIP_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['mergeRequestIid', 'Merge request'],
  ['pipelineId', 'Pipeline'],
  ['buildNumber', 'Build'],
  ['failedJobCount', 'Failed jobs'],
  ['failedStageCount', 'Failed stages'],
  ['failedTestCount', 'Failed tests'],
  ['issueDelta', 'Issue change'],
  ['unresolvedIssueCount', 'Unresolved issues'],
  ['projectKey', 'SonarQube project'],
  ['branch', 'Branch'],
];

function eventIcon(event: MonitorEvent, severityOverride?: ReturnType<typeof attentionSeverity>): vscode.ThemeIcon {
  const providerIcon = attentionProviderIconId(event.source);
  if (providerIcon) {
    const severity = severityOverride || attentionSeverity(event);
    return new vscode.ThemeIcon(providerIcon, new vscode.ThemeColor(attentionSeverityColorId(severity)));
  }
  switch (severityOverride || attentionSeverity(event)) {
    case 'failure': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'partial': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'blocked': return new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('list.errorForeground'));
    case 'recovery': return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
    case 'warning': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'information': return new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.yellow'));
  }
}

function displayTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
