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
}

interface AttentionEntry {
  event: MonitorEvent;
  session: WorkSessionRecord | undefined;
  ticketKey: string | undefined;
  providerUrl: string | undefined;
  providerChoices: AttentionProviderChoice[];
}

/** Shows only the newest unacknowledged state per provider stream, grouped only by local project. */
export class AttentionTreeProvider implements vscode.TreeDataProvider<AttentionTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AttentionTreeItem | undefined>();
  private readonly loadMonitorEvents: () => MonitorEvent[];
  private readonly loadWorkSessions: () => WorkSessionRecord[];
  private readonly loadRegisteredProjects: () => readonly AttentionRegisteredProject[];
  private readonly loadProjectDisplayName: (projectName: string) => string | undefined;
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
    const entries = this.unacknowledgedEntries();
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
      .sort((left, right) => right.newestAt.localeCompare(left.newestAt)
        || left.labelText.localeCompare(right.labelText));
    return [...warningItems, ...groups];
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private unacknowledgedEntries(): AttentionEntry[] {
    let events: MonitorEvent[];
    try {
      events = this.loadMonitorEvents();
    } catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos attention refresh failed: ${boundedOperationFailure(error, 'Attention events could not be read.').display}`);
      return [];
    }

    const sessions = this.safeLoadWorkSessions();
    const registeredProjects = this.safeLoadRegisteredProjects();
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
}

export type AttentionTreeItem = AttentionGroupTreeItem | AttentionEventTreeItem | AttentionMessageTreeItem;

export class AttentionGroupTreeItem extends vscode.TreeItem {
  readonly newestAt: string;
  readonly labelText: string;
  readonly projectName: string | undefined;

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
    this.newestAt = newest.event.at;
    this.labelText = label;
    this.projectName = projectName;
    this.id = group.id;
    this.contextValue = 'attention_group';
    this.description = `${entries.length} item${entries.length === 1 ? '' : 's'} • ${displayTimestamp(this.newestAt)}`;
    this.tooltip = [
      `Project: ${label}`,
      `${entries.length} current item${entries.length === 1 ? '' : 's'}`,
      `Latest update: ${formatDateTimeLabel(this.newestAt, 'Unknown')}`,
      'Expand to review provider changes.',
    ].join('\n');
    this.iconPath = new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.yellow'));
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
    const presentation = attentionEventPresentation(entry.event, entry.session);
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
    const actionContext = attentionActionContext(
      this.source,
      this.ticketKey,
      this.providerUrl,
      this.projectName,
    );
    this.contextValue = attentionEventCanUsePromptContext(entry.event)
      ? `${actionContext}_event`
      : actionContext;
    this.description = presentation.description;
    this.tooltip = eventTooltip(entry);
    this.iconPath = eventIcon(entry.event);
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
    super(kind === 'warning' ? 'Attention may be incomplete' : 'No changes need attention', vscode.TreeItemCollapsibleState.None);
    if (kind === 'warning') {
      this.contextValue = 'attention_error';
      this.description = 'Open Check Setup, then refresh';
      this.tooltip = 'Kronos could not load all saved provider updates. Select to open Check Setup.';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      this.command = { command: 'kronos.doctor', title: 'Check Setup' };
      return;
    }
    this.contextValue = 'attention_empty';
    this.tooltip = 'Merge request, build, quality, and provider problems appear here. Clear an item after review; its Session history remains available.';
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
    attentionEventCanUsePromptContext(event)
      ? 'Right-click to use this exact event in a prompt, review broader context, open history, or Clear from Attention.'
      : 'Right-click for available context, history, and Clear from Attention.',
    `After clearing: ${event.source === 'gitlab' && event.subject?.kind === 'merge-request' ? 'an open merge request returns after the next successful check; merged or closed requests stay cleared' : 'the item stays cleared until its state changes'}`,
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

function eventIcon(event: MonitorEvent): vscode.ThemeIcon {
  const providerIcon = attentionProviderIconId(event.source);
  if (providerIcon) {
    const severity = attentionSeverity(event);
    return new vscode.ThemeIcon(providerIcon, new vscode.ThemeColor(attentionSeverityColorId(severity)));
  }
  switch (attentionSeverity(event)) {
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
