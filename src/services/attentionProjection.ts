import type { MonitorEvent } from './monitorEventStore';
import { providerTransitionStreamKey } from './providerTransitionStreams';
import type { WorkSessionRecord } from './workSessionStore';

/**
 * Rebuilds the current Attention projection from durable audit history.
 * Restart, reload, and another VS Code window therefore produce the same
 * newest-per-stream result from the same normalized records.
 */
export function currentAttentionTransitions(
  events: readonly MonitorEvent[],
  sessions: readonly WorkSessionRecord[],
): MonitorEvent[] {
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const acknowledged = acknowledgedEventKeys(events);
  const newestFirst = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'provider.transition' && sessionsById.has(event.sessionId))
    .sort((left, right) => right.event.at.localeCompare(left.event.at)
      || left.index - right.index
      || right.event.id.localeCompare(left.event.id));
  const latestByStream = new Map<string, MonitorEvent>();
  for (const { event } of newestFirst) {
    const stream = providerTransitionStreamKey(event, sessionsById.get(event.sessionId));
    if (!latestByStream.has(stream)) { latestByStream.set(stream, event); }
  }
  return [...latestByStream.values()]
    .filter(event => !acknowledged.has(attentionEventKey(event.sessionId, event.id)))
    .sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
}

function acknowledgedEventKeys(events: readonly MonitorEvent[]): Set<string> {
  const acknowledged = new Set<string>();
  for (const event of events) {
    if (event.type !== 'notification.acknowledged') { continue; }
    const acknowledgedEventId = event.metadata?.['acknowledgedEventId'];
    if (typeof acknowledgedEventId === 'string' && acknowledgedEventId) {
      acknowledged.add(attentionEventKey(event.sessionId, acknowledgedEventId));
    }
  }
  return acknowledged;
}

function attentionEventKey(sessionId: string, eventId: string): string {
  return `${sessionId}:${eventId}`;
}
