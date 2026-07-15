import * as vscode from 'vscode';
import { boundedOperationFailure } from '../services/errorUtils';
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
import { currentAttentionTransitions } from '../services/attentionProjection';
import { normalizeProviderPublicUrl } from '../services/providerUrls';
import { providerBindingsForEvent } from '../services/providerBindingReconciliation';
import {
  attentionActionContext,
  attentionEventPresentation,
  attentionProviderIconId,
  attentionProviderChoicesForEvent,
  attentionSeverity,
  attentionSeverityColorId,
  attentionTicketKey,
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
}

interface AttentionEntry {
  event: MonitorEvent;
  session: WorkSessionRecord | undefined;
  ticketKey: string | undefined;
  providerUrl: string | undefined;
  providerChoices: AttentionProviderChoice[];
}

/** Shows only the newest unacknowledged state per provider stream, grouped by project when known. */
export class AttentionTreeProvider implements vscode.TreeDataProvider<AttentionTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AttentionTreeItem | undefined>();
  private readonly loadMonitorEvents: () => MonitorEvent[];
  private readonly loadWorkSessions: () => WorkSessionRecord[];
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(options: AttentionTreeProviderOptions = {}) {
    this.loadMonitorEvents = options.loadMonitorEvents
      ?? (() => listMonitorEvents({
        types: ['provider.transition', 'notification.acknowledged'],
        limit: 2000,
      }));
    this.loadWorkSessions = options.loadWorkSessions ?? (() => listWorkSessions());
  }

  getTreeItem(element: AttentionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AttentionTreeItem): AttentionTreeItem[] {
    if (element instanceof AttentionGroupTreeItem) {
      return element.entries.map(entry => new AttentionEventTreeItem(entry));
    }
    if (element) { return []; }

    const entries = this.unacknowledgedEntries();
    if (entries.length === 0) {
      return [new AttentionMessageTreeItem()];
    }

    const grouped = new Map<string, AttentionEntry[]>();
    for (const entry of entries) {
      const groupKey = entry.session?.projectName
        ? `project:${entry.session.projectName}`
        : `session:${entry.event.sessionId}`;
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(groupKey, [entry]);
      }
    }

    return [...grouped.values()]
      .map(groupEntries => new AttentionGroupTreeItem(groupEntries))
      .sort((left, right) => right.newestAt.localeCompare(left.newestAt)
        || left.labelText.localeCompare(right.labelText));
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
      console.warn(`Kronos attention refresh failed: ${boundedOperationFailure(error, 'Attention events could not be read.').display}`);
      return [];
    }

    const sessions = this.safeLoadWorkSessions();
    const sessionsById = new Map(sessions.map(session => [session.id, session]));
    return currentAttentionTransitions(events, sessions)
      .map(event => {
        const session = sessionsById.get(event.sessionId);
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
      console.warn(`Kronos attention session correlation failed: ${boundedOperationFailure(error, 'Attention session state could not be read.').display}`);
      return [];
    }
  }
}

export type AttentionTreeItem = AttentionGroupTreeItem | AttentionEventTreeItem | AttentionMessageTreeItem;

export class AttentionGroupTreeItem extends vscode.TreeItem {
  readonly newestAt: string;
  readonly labelText: string;
  readonly workSessionId: string;
  readonly ticketKey: string | undefined;

  constructor(readonly entries: readonly AttentionEntry[]) {
    const newest = entries[0];
    if (!newest) { throw new Error('Attention groups require at least one event.'); }
    const session = newest.session;
    const ticketKeys = [...new Set(entries.map(entry => entry.ticketKey).filter((value): value is string => Boolean(value)))];
    const ticketKey = ticketKeys.length === 1 ? ticketKeys[0] : undefined;
    const projectName = session?.projectName;
    const label = projectName
      ? projectName
      : ticketKey ? `${ticketKey}: ${session?.title || 'Provider changes'}`
        : session?.title || `Work session ${newest.event.sessionId}`;
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.newestAt = newest.event.at;
    this.labelText = label;
    this.workSessionId = newest.event.sessionId;
    this.ticketKey = ticketKey;
    this.id = `attention-group:${projectName || this.workSessionId}`;
    this.contextValue = 'attention_group';
    this.description = `${entries.length} unacknowledged • newest ${displayTimestamp(this.newestAt)}`;
    this.tooltip = [
      `Work session: ${this.workSessionId}`,
      `Project: ${projectName || 'none'}`,
      `Ticket contexts: ${ticketKeys.join(', ') || 'none'}`,
      `Unacknowledged provider transitions: ${entries.length}`,
      `Newest transition: ${this.newestAt}`,
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

  constructor(readonly entry: AttentionEntry) {
    super(entry.event.summary, vscode.TreeItemCollapsibleState.None);
    this.eventId = entry.event.id;
    this.sessionId = entry.event.sessionId;
    this.workSessionId = entry.event.sessionId;
    this.ticketKey = entry.ticketKey;
    this.source = entry.event.source;
    this.providerUrl = entry.providerUrl;
    this.providerChoices = [...entry.providerChoices];
    const target: AttentionCommandTarget = {
      eventId: this.eventId,
      sessionId: this.sessionId,
      workSessionId: this.workSessionId,
      ticketKey: this.ticketKey,
      source: this.source,
      providerUrl: this.providerUrl,
      ...(this.providerChoices.length > 1 ? { providerChoices: this.providerChoices } : {}),
      ...(entry.session?.projectName ? { projectName: entry.session.projectName } : {}),
      ...(entry.session?.projectPath ? { projectPath: entry.session.projectPath } : {}),
    };

    this.id = `attention-event:${entry.event.id}`;
    this.contextValue = attentionActionContext(this.source, this.ticketKey, this.providerUrl);
    this.description = attentionEventPresentation(entry.event, entry.session).description;
    this.tooltip = eventTooltip(entry);
    this.iconPath = eventIcon(entry.event);
    this.command = this.providerUrl
      ? {
        command: 'kronos.openProvider',
        title: 'Open Provider Page',
        arguments: [target],
      }
      : entry.session?.projectName && entry.session.projectPath
        ? {
          command: 'kronos.configureProjectIntegrations',
          title: 'Repair Provider Setup',
          arguments: [target],
        }
        : {
          command: 'kronos.doctor',
          title: 'Open Kronos Doctor',
        };
  }
}

export class AttentionMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('No provider or monitoring changes need attention', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'attention_empty';
    this.description = 'monitoring is clear';
    this.tooltip = 'Current GitLab, Jenkins, SonarQube, provider-health, and local-monitoring transitions stay here until you clear them.';
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
  const before = event.before?.state || 'unknown';
  const after = event.after?.state || 'unknown';
  const lines = [
    'Current Attention state (audit history is retained after clearing)',
    `Event: ${event.id}`,
    `Project: ${presentation.project}`,
    `Ticket: ${entry.ticketKey || 'unknown'}`,
    `Work session: ${event.sessionId}`,
    `Provider: ${presentation.provider}`,
    `Subject: ${presentation.subject}`,
    `Severity: ${presentation.severity}`,
    `Why attention: ${presentation.why}`,
    `State: ${before} -> ${after}`,
    `Transition: ${metadataString(event, 'transitionKind') || 'provider state changed'}`,
    `Observed: ${presentation.observedAt}`,
    `Last changed: ${presentation.changedAt}`,
    `Provider URL: ${entry.providerUrl || 'not recorded'}`,
    `Primary action: ${entry.providerUrl ? 'open the validated provider page' : entry.session?.projectName && entry.session.projectPath ? 'repair this project provider setup' : 'open Kronos Doctor'}`,
    `Clear behavior: ${event.source === 'gitlab' && event.subject?.kind === 'merge-request' ? 'an open MR returns after the next successful poll; merged or closed MRs stay cleared' : 'the row stays cleared until a real state transition occurs'}`,
  ];
  for (const [key, label] of METADATA_TOOLTIP_FIELDS) {
    const value = event.metadata?.[key];
    if (value !== undefined && value !== null) { lines.push(`${label}: ${String(value)}`); }
  }
  return lines.join('\n');
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

function metadataString(event: MonitorEvent, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function displayTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
