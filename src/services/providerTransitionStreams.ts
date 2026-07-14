import * as crypto from 'crypto';
import type {
  MonitorEventMetadataValue,
  MonitorEventSource,
  MonitorEventSubject,
} from './monitorEventStore';
import type { WorkSessionRecord } from './workSessionStore';

interface ProviderTransitionEventLike {
  sessionId: string;
  source: MonitorEventSource;
  subject?: MonitorEventSubject;
  metadata?: Record<string, MonitorEventMetadataValue>;
}

/**
 * Canonical Attention stream identity:
 * scope (project or session) + provider + resource + logical subject + facet.
 *
 * Occurrence IDs such as pipeline IDs and Jenkins build numbers deliberately
 * do not become logical subjects. A newer occurrence must replace the stale
 * row for the same MR pipeline or project job. MR IIDs and SonarQube branches
 * remain subjects because multiple current MRs or analyzed branches may need
 * independent attention.
 */
export function providerTransitionStreamKey(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): string {
  const identity = providerTransitionStreamIdentity(event, session);
  const digest = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `provider-stream-${digest.slice(0, 48)}`;
}

function providerTransitionStreamIdentity(
  event: ProviderTransitionEventLike,
  session: WorkSessionRecord | undefined,
): readonly string[] {
  const transitionKind = metadataString(event, 'transitionKind');
  const providerRead = transitionKind.startsWith('provider_read_')
    || event.subject?.kind === 'provider-read';
  const resource = providerRead ? 'provider-read' : event.subject?.kind || 'provider-event';
  const scope = session?.projectName
    ? `project:${session.projectName}`
    : `session:${event.sessionId}`;
  return [
    scope,
    event.source,
    resource,
    logicalSubject(event, resource),
    attentionFacet(resource),
  ];
}

function logicalSubject(event: ProviderTransitionEventLike, resource: string): string {
  if (resource === 'provider-read') {
    return event.source === 'gitlab'
      ? metadataIdentity(event, 'mergeRequestIid', 'merge-request') || event.source
      : event.source;
  }
  if (resource === 'pipeline') {
    return metadataIdentity(event, 'mergeRequestIid', 'merge-request') || 'current-merge-request';
  }
  if (resource === 'build') { return 'configured-job'; }
  if (resource === 'merge-request') {
    return metadataIdentity(event, 'mergeRequestIid', 'merge-request')
      || `merge-request:${event.subject?.id || 'current'}`;
  }
  if (resource === 'quality-gate') {
    const projectKey = metadataString(event, 'projectKey');
    const branch = metadataString(event, 'branch');
    if (projectKey || branch) { return `sonar:${projectKey || 'project'}:${branch || 'branch'}`; }
  }
  return event.subject?.id || 'current';
}

function attentionFacet(resource: string): string {
  if (resource === 'merge-request') { return 'state-and-review'; }
  if (resource === 'pipeline') { return 'pipeline-jobs-and-tests'; }
  if (resource === 'build') { return 'build-stages-and-tests'; }
  if (resource === 'quality-gate') { return 'gate-and-issues'; }
  return resource;
}

function metadataIdentity(
  event: ProviderTransitionEventLike,
  key: string,
  prefix: string,
): string | undefined {
  const value = event.metadata?.[key];
  return (typeof value === 'string' || typeof value === 'number') && String(value)
    ? `${prefix}:${String(value)}`
    : undefined;
}

function metadataString(event: ProviderTransitionEventLike, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : '';
}
