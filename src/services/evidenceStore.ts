import * as fs from 'fs';
import * as path from 'path';
import { Ticket } from '../state/types';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceRiskNotes, evidenceString } from './evidenceData';
import { safeFileStem } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { ticketStringArray } from './ticketFields';

const EVIDENCE_DIR = path.join(KRONOS_DIR, 'evidence');

export interface EvidenceExport {
  markdown: string;
  comment: string;
  filePath: string;
}

function formatEvidenceMarkdown(ticketKey: string, ticket: Ticket): string {
  const lines = [
    `# Evidence for ${ticketKey}`,
    '',
    `- Summary: ${ticket.summary || ''}`,
    `- Type: ${ticket.type || ''}`,
    `- Priority: ${ticket.priority || ''}`,
    `- Jira status: ${ticket.jira_status || ''}`,
    `- Next action: ${ticket.next_action || ''}`,
    `- Projects: ${ticketStringArray(ticket.projects).join(', ') || 'none'}`,
  ];

  if (ticket.jira_url) { lines.push(`- Jira: ${ticket.jira_url}`); }
  if (ticket.mr) {
    lines.push(`- MR: !${ticket.mr.iid} ${ticket.mr.state} / ${ticket.mr.review_status} ${ticket.mr.url}`);
  }
  if (ticket.build) {
    lines.push(`- Build: #${ticket.build.number} ${ticket.build.status} ${ticket.build.url}`);
  }

  const criteria = evidenceAcceptanceCriteria(ticket);
  lines.push('', '## Acceptance Criteria', '');
  if (criteria.length === 0) {
    lines.push('_No acceptance criteria recorded._');
  } else {
    for (const criterion of criteria) {
      lines.push(`- [${evidenceChecked(criterion) ? 'x' : ' '}] ${evidenceString(criterion, 'text', 'Untitled criterion')}`);
    }
  }

  lines.push('', '## Evidence Checks', '');
  const checks = evidenceChecks(ticket);
  if (checks.length === 0) {
    lines.push('_No structured evidence checks recorded._');
  } else {
    for (const check of checks) {
      const environment = evidenceString(check, 'environment');
      lines.push(`- ${evidenceString(check, 'at', 'unknown time')} [${evidenceString(check, 'result', 'unknown')}] ${evidenceString(check, 'name', 'Unnamed check')}${environment ? ` (${environment})` : ''}`);
      if (evidenceString(check, 'command')) { lines.push(`  - Command: \`${evidenceString(check, 'command')}\``); }
      if (evidenceString(check, 'summary')) { lines.push(`  - Summary: ${evidenceString(check, 'summary')}`); }
      if (evidenceString(check, 'confidence')) { lines.push(`  - Confidence: ${evidenceString(check, 'confidence')}`); }
      if (evidenceString(check, 'artifact_path')) { lines.push(`  - Artifact: ${evidenceString(check, 'artifact_path')}`); }
    }
  }

  lines.push('', '## Environment Results', '');
  const environments = evidenceEnvironmentResults(ticket);
  if (environments.length === 0) {
    lines.push('_No environment results recorded._');
  } else {
    for (const result of environments) {
      lines.push(`- ${evidenceString(result, 'environment', 'environment')}: ${evidenceString(result, 'status', 'unknown')} at ${evidenceString(result, 'checked_at', 'unknown time')} - ${evidenceString(result, 'detail')}`);
      if (evidenceString(result, 'artifact_path')) { lines.push(`  - Artifact: ${evidenceString(result, 'artifact_path')}`); }
    }
  }

  lines.push('', '## Evidence Notes', '');
  const notes = evidenceNotes(ticket);
  if (notes.length === 0) {
    lines.push('_No evidence notes recorded._');
  } else {
    for (const note of notes) {
      lines.push(`- ${evidenceString(note, 'at', 'unknown time')} [${evidenceString(note, 'kind', 'note')}] ${evidenceString(note, 'text')}`);
    }
  }

  lines.push('', '## Risk / Follow-up', '');
  const risks = [
    ...notes.filter(note => evidenceString(note, 'kind') === 'risk').map(note => ({ text: evidenceString(note, 'text'), severity: undefined })),
    ...evidenceRiskNotes(ticket).map(note => ({ text: evidenceString(note, 'text'), severity: evidenceString(note, 'severity') })),
  ];
  if (risks.length === 0) {
    lines.push('_No risk notes recorded._');
  } else {
    for (const note of risks) {
      lines.push(`- ${note.severity ? `[${note.severity}] ` : ''}${note.text}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatEvidenceComment(ticketKey: string, ticket: Ticket): string {
  const notes = evidenceNotes(ticket);
  const lines = [
    `Kronos evidence for ${ticketKey}`,
    `Summary: ${ticket.summary || ''}`,
  ];
  if (ticket.build) {
    lines.push(`Build: #${ticket.build.number} ${ticket.build.status}`);
  }
  if (ticket.mr) {
    lines.push(`MR: !${ticket.mr.iid} ${ticket.mr.state} / ${ticket.mr.review_status}`);
  }
  const criteria = evidenceAcceptanceCriteria(ticket);
  lines.push('', 'Acceptance criteria:');
  if (criteria.length === 0) {
    lines.push('- None recorded.');
  } else {
    for (const criterion of criteria) {
      lines.push(`- [${evidenceChecked(criterion) ? 'x' : ' '}] ${evidenceString(criterion, 'text', 'Untitled criterion')}`);
    }
  }
  const checks = evidenceChecks(ticket);
  lines.push('', 'Evidence checks:');
  if (checks.length === 0) {
    lines.push('- None recorded.');
  } else {
    for (const check of checks) {
      const environment = evidenceString(check, 'environment');
      const summary = evidenceString(check, 'summary');
      lines.push(`- [${evidenceString(check, 'result', 'unknown')}] ${evidenceString(check, 'name', 'Unnamed check')}${environment ? ` (${environment})` : ''}${summary ? ` - ${summary}` : ''}`);
    }
  }
  const environments = evidenceEnvironmentResults(ticket);
  lines.push('', 'Environment results:');
  if (environments.length === 0) {
    lines.push('- None recorded.');
  } else {
    for (const result of environments) {
      lines.push(`- [${evidenceString(result, 'status', 'unknown')}] ${evidenceString(result, 'environment', 'environment')}: ${evidenceString(result, 'detail')}`);
    }
  }
  lines.push('', 'Evidence:');
  if (notes.length === 0) {
    lines.push('- No evidence notes recorded.');
  } else {
    for (const note of notes) {
      lines.push(`- [${evidenceString(note, 'kind', 'note')}] ${evidenceString(note, 'text')}`);
    }
  }
  return lines.join('\n');
}

export function writeEvidenceExport(ticketKey: string, ticket: Ticket): EvidenceExport {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const safeKey = safeFileStem(ticketKey, { fallback: 'ticket' });
  const filePath = path.join(EVIDENCE_DIR, `${safeKey}.md`);
  const markdown = formatEvidenceMarkdown(ticketKey, ticket);
  const comment = formatEvidenceComment(ticketKey, ticket);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, markdown);
  fs.renameSync(tmpPath, filePath);
  return { markdown, comment, filePath };
}
