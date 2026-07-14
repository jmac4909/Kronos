import type { MonitorEvent } from './monitorEventStore';
import type { WorkSessionRecord } from './workSessionStore';

const MAX_TIMELINE_EVENTS = 500;

export function buildWorkSessionAuditMarkdown(
  session: WorkSessionRecord,
  events: readonly MonitorEvent[],
): string {
  const providers = [...new Set(session.providerBindings.map(binding => binding.provider))];
  const attachedTerminals = session.terminals.filter(terminal => terminal.status === 'attached').length;
  const heading = session.kind === 'ticket'
    ? `${session.ticketKey} managed work session`
    : `${session.title} managed session`;
  const lines = [
    `# ${markdownText(heading)}`,
    '',
    markdownText(session.title),
    '',
    '> Kronos records session metadata, provider transitions, and context artifact references. It does not collect operator terminal input or output.',
    '',
    '## Current state',
    '',
    `- Session: \`${inlineCode(session.id)}\``,
    `- Kind: ${session.kind === 'ticket' ? `ticket-linked (${markdownText(session.ticketKey)})` : 'standalone'}`,
    `- Status: ${markdownText(session.status)}`,
    `- Operator terminals currently recorded as attached: ${attachedTerminals}`,
    `- Monitoring: ${session.monitoring.enabled ? 'enabled' : 'disabled'}`,
    `- Monitoring readiness: ${markdownText(session.monitoring.lastState || 'not yet polled')}`,
    `- Last monitoring result: ${markdownText(session.monitoring.lastSummary || 'none')}`,
    `- Last monitoring attempt: ${markdownText(session.monitoring.lastAttemptAt || 'never')}`,
    `- Last provider poll: ${markdownText(session.monitoring.lastPolledAt || 'not yet polled')}`,
    `- Providers: ${providers.length > 0 ? providers.map(markdownText).join(', ') : 'none'}`,
    `- Context artifacts: ${session.artifacts.length}`,
    `- Updated: ${markdownText(session.updatedAt)}`,
  ];

  if (session.artifacts.length > 0) {
    lines.push('', '## Context artifacts', '');
    for (const artifact of session.artifacts) {
      const completeness = artifact.complete ? 'complete' : 'partial';
      lines.push(`- ${markdownText(artifact.label)} (${completeness}, fetched ${markdownText(artifact.fetchedAt)})`);
      lines.push(`  - Prompt file: \`${inlineCode(artifact.promptPath)}\``);
      if (artifact.contentSha256) {
        lines.push(`  - Content SHA-256: \`${artifact.contentSha256}\``);
      }
      for (const warning of artifact.warnings.slice(0, 10)) {
        lines.push(`  - Warning: ${markdownText(warning)}`);
      }
    }
  }

  lines.push('', '## Timeline', '');
  const boundedEvents = events.slice(0, MAX_TIMELINE_EVENTS);
  if (boundedEvents.length === 0) {
    lines.push('_No audit events have been recorded for this session._');
  } else {
    for (const event of boundedEvents) {
      const subject = event.subject
        ? ` — ${markdownText(event.subject.kind)} \`${inlineCode(event.subject.id)}\``
        : '';
      lines.push(`- **${markdownText(event.at)}** · ${markdownText(event.source)} · ${markdownText(event.type)}${subject}`);
      lines.push(`  - ${markdownText(event.summary)}`);
      if (event.before?.state || event.after?.state) {
        lines.push(`  - State: ${markdownText(event.before?.state || 'unknown')} → ${markdownText(event.after?.state || 'unknown')}`);
      }
      if (event.artifactPath) {
        lines.push(`  - Artifact: \`${inlineCode(event.artifactPath)}\``);
      }
    }
  }

  if (events.length > boundedEvents.length) {
    lines.push('', `_Showing the newest ${boundedEvents.length} of ${events.length} supplied events._`);
  }
  lines.push('');
  return lines.join('\n');
}

function markdownText(value: string): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function inlineCode(value: string): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/`/g, 'ˋ')
    .replace(/\s+/g, ' ')
    .trim();
}
