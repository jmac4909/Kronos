import * as crypto from 'crypto';
import {
  appendMonitorEvent,
  listMonitorEvents,
  readMonitorEvent,
  type MonitorEvent,
  type MonitorEventSource,
  type MonitorEventSubject,
} from './monitorEventStore';
import { isProviderReadTransitionKind, providerReadStateSignature } from './providerReadTransitions';
import { providerTransitionStreamKey } from './providerTransitionStreams';
import type { WorkSessionRecord } from './workSessionStore';

export interface AppendTransitionInput {
  session: WorkSessionRecord & { ticketKey: string };
  source: MonitorEventSource;
  summary: string;
  subject: MonitorEventSubject;
  state: string;
  fingerprint: string;
  beforeState?: string;
  beforeFingerprint?: string;
  artifactPath: string;
  transitionKey: string;
  metadata: Record<string, string | number | boolean | null>;
}

/** Records one deterministic transition and suppresses unchanged provider-read health. */
export function appendTransitionOnce(input: AppendTransitionInput): MonitorEvent | null {
  if (repeatsCurrentProviderReadState(input)) { return null; }
  const id = deterministicEventId(
    input.session.id,
    input.source,
    input.transitionKey,
    input.subject.id,
    input.fingerprint,
  );
  if (readMonitorEvent(id)) { return null; }
  const eventInput: Parameters<typeof appendMonitorEvent>[0] = {
    id,
    sessionId: input.session.id,
    type: 'provider.transition',
    source: input.source,
    summary: input.summary,
    subject: input.subject,
    after: { state: input.state, fingerprint: input.fingerprint },
    artifactPath: input.artifactPath,
    metadata: {
      ...input.metadata,
      transitionKey: input.transitionKey,
      transitionStreamKey: providerTransitionStreamKey({
        sessionId: input.session.id,
        source: input.source,
        subject: input.subject,
        metadata: input.metadata,
      }, input.session),
    },
  };
  if (input.beforeState && input.beforeFingerprint) {
    eventInput.before = { state: input.beforeState, fingerprint: input.beforeFingerprint };
  }
  return appendMonitorEvent(eventInput);
}

export function deterministicEventId(...parts: string[]): string {
  const hash = crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `transition-${hash.slice(0, 48)}`;
}

function repeatsCurrentProviderReadState(input: AppendTransitionInput): boolean {
  if (!isProviderReadTransitionKind(input.metadata['transitionKind'])) { return false; }
  const previous = listMonitorEvents({
    sessionId: input.session.id,
    source: input.source,
    types: ['provider.transition'],
    limit: 2000,
  }).find(event => event.subject?.kind === input.subject.kind
    && event.subject.id === input.subject.id
    && isProviderReadTransitionKind(event.metadata?.['transitionKind']));
  if (!previous) { return false; }
  return providerReadStateSignature(
    previous.metadata?.['readState'],
    previous.after?.state,
    previous.metadata?.['readReason'],
    previous.metadata?.['readComponents'],
  ) === providerReadStateSignature(
    input.metadata['readState'],
    input.state,
    input.metadata['readReason'],
    input.metadata['readComponents'],
  );
}
