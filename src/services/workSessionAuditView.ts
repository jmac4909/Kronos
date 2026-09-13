import type { MonitorEvent } from './monitorEventStore';
import { workSessionDisplayName, type WorkSessionRecord } from './workSessionStore';

const MAX_TIMELINE_EVENTS = 500;

export function buildWorkSessionAuditMarkdown(
  session: WorkSessionRecord,
  events: readonly MonitorEvent[],
): string {
  const providers = [...new Set(session.providerBindings.map(binding => binding.provider))];
  const attachedTerminals = session.terminals.filter(terminal => terminal.status === 'attached').length;
  const sessionName = workSessionDisplayName(session);
  const heading = session.kind === 'ticket'
    ? `${session.projectName || session.ticketKey} Session history`
    : `${sessionName} history`;
  const lines = [
    `# ${markdownText(heading)}`,
    '',
    markdownText(sessionName),
    '',
    '> Kronos records Session details, provider updates, and saved context. It never reads terminal input or output.',
    '',
    '## Current state',
    '',
    `- Session ID: \`${inlineCode(session.id)}\``,
    `- Type: ${session.kind === 'ticket' ? `Jira-linked (${markdownText(session.ticketKey)})` : 'Standalone'}`,
    `- Jira tickets: ${session.ticketKeys.length > 0 ? session.ticketKeys.map(markdownText).join(', ') : 'None'}`,
    `- Status: ${markdownText(displayLabel(session.status))}`,
    `- Connected terminals: ${attachedTerminals}`,
    `- Provider updates: ${session.monitoring.enabled ? 'On' : 'Off'}`,
    `- Latest update state: ${markdownText(displayLabel(session.monitoring.lastState || 'not checked yet'))}`,
    `- Latest result: ${markdownText(session.monitoring.lastSummary || 'None')}`,
    `- Last checked: ${markdownText(session.monitoring.lastAttemptAt || 'Never')}`,
    `- Last successful check: ${markdownText(session.monitoring.lastPolledAt || 'Not yet')}`,
    `- Providers: ${providers.length > 0 ? providers.map(providerSourceLabel).map(markdownText).join(', ') : 'None'}`,
    `- Saved context: ${session.artifacts.length}`,
    `- Updated: ${markdownText(session.updatedAt)}`,
  ];

  if (session.artifacts.length > 0) {
    lines.push('', '## Saved context', '');
    for (const artifact of session.artifacts) {
      const completeness = artifact.complete ? 'Complete' : 'Needs review';
      lines.push(`- ${markdownText(artifact.label)} (${completeness}, saved ${markdownText(artifact.fetchedAt)})`);
      lines.push(`  - Saved file: \`${inlineCode(artifact.promptPath)}\``);
      if (artifact.contentSha256) {
        lines.push(`  - Content SHA-256: \`${artifact.contentSha256}\``);
      }
      for (const warning of artifact.warnings.slice(0, 10)) {
        lines.push(`  - Warning: ${markdownText(warning)}`);
      }
    }
  }

  lines.push('', '## History', '');
  const boundedEvents = [...events]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, MAX_TIMELINE_EVENTS);
  if (boundedEvents.length === 0) {
    lines.push('_No history yet._');
  } else {
    for (const event of boundedEvents) {
      const subject = event.subject
        ? ` — ${markdownText(displayLabel(event.subject.kind))} \`${inlineCode(event.subject.id)}\``
        : '';
      lines.push(`- **${markdownText(event.at)}** · ${markdownText(providerSourceLabel(event.source))} · ${markdownText(eventTypeLabel(event.type))}${subject}`);
      lines.push(`  - ${markdownText(event.summary)}`);
      if (event.before?.state || event.after?.state) {
        lines.push(`  - Status: ${markdownText(displayLabel(event.before?.state || 'unknown'))} → ${markdownText(displayLabel(event.after?.state || 'unknown'))}`);
      }
      if (event.artifactPath) {
        lines.push(`  - Saved file: \`${inlineCode(event.artifactPath)}\``);
      }
    }
  }

  if (events.length > boundedEvents.length) {
    lines.push('', `_Showing the newest ${boundedEvents.length} of ${events.length} history items._`);
  }
  lines.push('');
  return lines.join('\n');
}

function providerSourceLabel(value: string): string {
  return {
    jira: 'Jira',
    gitlab: 'GitLab',
    jenkins: 'Jenkins',
    sonar: 'SonarQube',
    kronos: 'Kronos',
    operator: 'You',
  }[value] || displayLabel(value);
}

function eventTypeLabel(value: MonitorEvent['type']): string {
  return {
    'session.created': 'Session created',
    'terminal.attached': 'Terminal connected',
    'terminal.detached': 'Terminal disconnected',
    'context.inserted': 'Context added',
    'provider.transition': 'Provider update',
    'provider.baseline': 'Provider baseline',
    'notification.shown': 'Notification shown',
    'notification.acknowledged': 'Notification cleared',
    'decision.recorded': 'Decision recorded',
  }[value];
}

function displayLabel(value: string): string {
  const label = String(value).replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'Unknown';
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
