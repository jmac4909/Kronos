import * as vscode from 'vscode';
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

export interface AttentionCommandTarget {
  eventId: string;
  sessionId: string;
  workSessionId: string;
  ticketKey: string | undefined;
  source: MonitorEventSource;
  providerUrl: string | undefined;
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
}

/** Shows only unacknowledged durable provider transitions, grouped by session. */
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
      const existing = grouped.get(entry.event.sessionId);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.event.sessionId, [entry]);
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
      console.warn(`Kronos attention refresh failed: ${errorMessage(error)}`);
      return [];
    }

    const acknowledged = new Set<string>();
    for (const event of events) {
      if (event.type !== 'notification.acknowledged') { continue; }
      const acknowledgedEventId = event.metadata?.['acknowledgedEventId'];
      if (typeof acknowledgedEventId === 'string' && acknowledgedEventId) {
        acknowledged.add(attentionEventKey(event.sessionId, acknowledgedEventId));
      }
    }

    const sessions = this.safeLoadWorkSessions();
    const sessionsById = new Map(sessions.map(session => [session.id, session]));
    return events
      .filter(event => event.type === 'provider.transition')
      .filter(event => !acknowledged.has(attentionEventKey(event.sessionId, event.id)))
      .filter(event => sessionsById.has(event.sessionId))
      .map(event => {
        const session = sessionsById.get(event.sessionId);
        return {
          event,
          session,
          ticketKey: event.subject?.ticketKey || session?.ticketKey,
          providerUrl: providerUrlForEvent(event, session),
        };
      })
      .sort((left, right) => right.event.at.localeCompare(left.event.at)
        || right.event.id.localeCompare(left.event.id));
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try {
      return this.loadWorkSessions();
    } catch (error: unknown) {
      console.warn(`Kronos attention session correlation failed: ${errorMessage(error)}`);
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
    const ticketKey = newest.ticketKey;
    const label = ticketKey
      ? `${ticketKey}: ${session?.title || 'Provider changes'}`
      : session?.title || `Work session ${newest.event.sessionId}`;
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.newestAt = newest.event.at;
    this.labelText = label;
    this.workSessionId = newest.event.sessionId;
    this.ticketKey = ticketKey;
    this.id = `attention-group:${this.workSessionId}`;
    this.contextValue = 'attention_group';
    this.description = `${entries.length} unacknowledged • newest ${displayTimestamp(this.newestAt)}`;
    this.tooltip = [
      `Work session: ${this.workSessionId}`,
      `Ticket: ${ticketKey || 'none'}`,
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

  constructor(readonly entry: AttentionEntry) {
    super(entry.event.summary, vscode.TreeItemCollapsibleState.None);
    this.eventId = entry.event.id;
    this.sessionId = entry.event.sessionId;
    this.workSessionId = entry.event.sessionId;
    this.ticketKey = entry.ticketKey;
    this.source = entry.event.source;
    this.providerUrl = entry.providerUrl;
    const target: AttentionCommandTarget = {
      eventId: this.eventId,
      sessionId: this.sessionId,
      workSessionId: this.workSessionId,
      ticketKey: this.ticketKey,
      source: this.source,
      providerUrl: this.providerUrl,
    };

    this.id = `attention-event:${entry.event.id}`;
    this.contextValue = 'attention_item';
    this.description = eventDescription(entry.event);
    this.tooltip = eventTooltip(entry);
    this.iconPath = eventIcon(entry.event);
    this.command = this.providerUrl
      ? {
        command: 'kronos.openProvider',
        title: 'Open Provider Page',
        arguments: [target],
      }
      : {
        command: 'kronos.openWorkSessionAudit',
        title: 'Open Work Session Audit',
        arguments: [target],
      };
  }
}

export class AttentionMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('No provider changes need attention', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'attention_empty';
    this.description = 'monitoring is clear';
    this.tooltip = 'New GitLab, Jenkins, and SonarQube transitions stay here until you acknowledge them.';
    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  }
}

function providerUrlForEvent(event: MonitorEvent, session: WorkSessionRecord | undefined): string | undefined {
  if (!session || !isProviderSource(event.source)) { return undefined; }
  const bindings = session.providerBindings.filter(binding => binding.provider === event.source);
  const exact = bindings.find(binding => binding.subjectId === event.subject?.id && binding.url);
  const resourceMatched = bindings.find(binding => binding.url && subjectMatchesResource(event.subject?.kind, binding));
  const candidate = exact?.url || resourceMatched?.url || bindings.find(binding => binding.url)?.url;
  return candidate ? safePublicHttpUrl(candidate) : undefined;
}

function isProviderSource(source: MonitorEventSource): source is WorkSessionProviderBinding['provider'] {
  return source === 'jira' || source === 'gitlab' || source === 'jenkins' || source === 'sonar';
}

function subjectMatchesResource(kind: string | undefined, binding: WorkSessionProviderBinding): boolean {
  if (!kind) { return false; }
  if (kind === binding.resource) { return true; }
  return (kind === 'pipeline' && binding.resource === 'merge-request')
    || (kind === 'build' && binding.resource === 'job')
    || (kind === 'quality-gate' && binding.resource === 'branch');
}

function safePublicHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function eventDescription(event: MonitorEvent): string {
  const state = event.after?.state || metadataString(event, 'transitionKind') || 'changed';
  return `${providerLabel(event.source)} • ${state} • ${displayTimestamp(event.at)}`;
}

function eventTooltip(entry: AttentionEntry): string {
  const event = entry.event;
  const before = event.before?.state || 'unknown';
  const after = event.after?.state || 'unknown';
  const lines = [
    'Unacknowledged provider transition',
    `Event: ${event.id}`,
    `Ticket: ${entry.ticketKey || 'unknown'}`,
    `Work session: ${event.sessionId}`,
    `Provider: ${providerLabel(event.source)}`,
    `Subject: ${event.subject ? `${event.subject.kind} ${event.subject.id}` : 'unknown'}`,
    `State: ${before} -> ${after}`,
    `Transition: ${metadataString(event, 'transitionKind') || 'provider state changed'}`,
    `Observed: ${event.at}`,
    `Provider URL: ${entry.providerUrl || 'not recorded'}`,
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
];

function eventIcon(event: MonitorEvent): vscode.ThemeIcon {
  const transitionKind = metadataString(event, 'transitionKind').toLowerCase();
  const failure = transitionKind.includes('failed')
    || transitionKind.includes('canceled')
    || transitionKind.includes('increased');
  return failure
    ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
    : new vscode.ThemeIcon('bell-dot', new vscode.ThemeColor('charts.yellow'));
}

function metadataString(event: MonitorEvent, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function providerLabel(source: MonitorEventSource): string {
  if (source === 'gitlab') { return 'GitLab'; }
  if (source === 'jenkins') { return 'Jenkins'; }
  if (source === 'sonar') { return 'SonarQube'; }
  if (source === 'jira') { return 'Jira'; }
  return source;
}

function displayTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function attentionEventKey(sessionId: string, eventId: string): string {
  return `${sessionId}:${eventId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error.');
}
