import { Ticket } from '../state/types';
import { extractCriterionTexts } from './acceptanceCriteria';
import { isReviewReadyAction } from './actionSemantics';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceRecordCount, evidenceRiskNotes, evidenceString } from './evidenceData';

export type EvidenceGateStatus = 'pass' | 'warn' | 'fail';
export type EvidenceGateCheckKind = 'project' | 'notes' | 'test' | 'acceptance' | 'build' | 'mr' | 'risk' | 'environment';

export interface EvidenceGateCheck {
  kind: EvidenceGateCheckKind;
  status: EvidenceGateStatus;
  title: string;
  detail: string;
}

export interface EvidenceGateResult {
  ticketKey: string;
  status: EvidenceGateStatus;
  ready: boolean;
  checks: EvidenceGateCheck[];
  summary: string;
}

export function evaluateEvidenceGate(ticketKey: string, ticket: Ticket): EvidenceGateResult {
  const checks: EvidenceGateCheck[] = [];
  const reviewReady = isReviewReadyAction(ticket.next_action);
  const notes = evidenceNotes(ticket);
  const structuredChecks = evidenceChecks(ticket);
  const environmentResults = evidenceEnvironmentResults(ticket);
  const evidenceCount = evidenceRecordCount(ticket);
  const criteria = evidenceAcceptanceCriteria(ticket);
  const apparentCriteria = extractCriterionTexts(ticket.description || '');

  if (!ticket.projects || ticket.projects.length === 0) {
    checks.push(fail('project', 'No linked project', 'Link the ticket to at least one project before handoff.'));
  } else {
    checks.push(pass('project', 'Project link present', ticket.projects.join(', ')));
  }

  if (evidenceCount === 0 && reviewReady) {
    checks.push(fail('notes', 'No evidence records', `Ticket action is ${ticket.next_action}; add verification or implementation evidence.`));
  } else if (evidenceCount === 0) {
    checks.push(warn('notes', 'No evidence records yet', 'Add notes as soon as implementation or verification starts.'));
  } else if (notes.length === 0) {
    checks.push(warn('notes', 'No narrative evidence note', `${structuredChecks.length + environmentResults.length} structured evidence record${structuredChecks.length + environmentResults.length === 1 ? '' : 's'} present.`));
  } else {
    checks.push(pass('notes', `${notes.length} evidence note${notes.length === 1 ? '' : 's'}`, 'Evidence ledger is populated.'));
  }

  const testNotes = notes.filter(note => evidenceString(note, 'kind') === 'test');
  const failedEvidenceChecks = structuredChecks.filter(check => evidenceString(check, 'result') === 'fail');
  const passingEvidenceChecks = structuredChecks.filter(check => evidenceString(check, 'result') === 'pass');
  const warningEvidenceChecks = structuredChecks.filter(check => {
    const result = evidenceString(check, 'result');
    return result === 'warn' || result === 'unknown';
  });
  const hasPassingTestEvidence = testNotes.length > 0 || passingEvidenceChecks.length > 0;
  if (failedEvidenceChecks.length > 0) {
    checks.push(fail('test', `${failedEvidenceChecks.length} evidence check${failedEvidenceChecks.length === 1 ? '' : 's'} failed`, failedEvidenceChecks.map(check => evidenceString(check, 'name', 'unnamed check')).join('; ')));
  }
  if (warningEvidenceChecks.length > 0 && (!reviewReady || hasPassingTestEvidence)) {
    checks.push(warn('test', `${warningEvidenceChecks.length} evidence check${warningEvidenceChecks.length === 1 ? '' : 's'} need review`, warningEvidenceChecks.map(check => evidenceString(check, 'name', 'unnamed check')).join('; ')));
  }
  if (reviewReady && !hasPassingTestEvidence && failedEvidenceChecks.length === 0) {
    const title = warningEvidenceChecks.length > 0 ? 'No passing test evidence' : 'No test evidence';
    const detail = warningEvidenceChecks.length > 0
      ? `Warning or unknown evidence checks need follow-up: ${warningEvidenceChecks.map(check => evidenceString(check, 'name', 'unnamed check')).join('; ')}.`
      : 'Add at least one passing test/build/local verification note or structured evidence check before review.';
    checks.push(warn('test', title, detail));
  } else if (hasPassingTestEvidence) {
    checks.push(pass('test', `${testNotes.length + passingEvidenceChecks.length} test evidence item${testNotes.length + passingEvidenceChecks.length === 1 ? '' : 's'}`, 'Test evidence is present.'));
  }

  const failedEnvironments = environmentResults.filter(result => evidenceString(result, 'status') === 'fail');
  const warningEnvironments = environmentResults.filter(result => evidenceString(result, 'status') === 'warn' || evidenceString(result, 'status') === 'unknown');
  if (failedEnvironments.length > 0) {
    checks.push(fail('environment', `${failedEnvironments.length} environment result${failedEnvironments.length === 1 ? '' : 's'} failed`, failedEnvironments.map(result => `${evidenceString(result, 'environment', 'environment')}: ${evidenceString(result, 'detail')}`).join('; ')));
  } else if (warningEnvironments.length > 0) {
    checks.push(warn('environment', `${warningEnvironments.length} environment result${warningEnvironments.length === 1 ? '' : 's'} need review`, warningEnvironments.map(result => `${evidenceString(result, 'environment', 'environment')}: ${evidenceString(result, 'status', 'unknown')}`).join('; ')));
  } else if (environmentResults.length > 0) {
    checks.push(pass('environment', `${environmentResults.length} environment result${environmentResults.length === 1 ? '' : 's'} passing`, environmentResults.map(result => evidenceString(result, 'environment', 'environment')).join(', ')));
  }

  if (apparentCriteria.length > 0 && criteria.length === 0) {
    checks.push(warn('acceptance', 'Acceptance criteria not extracted', 'Run Extract Acceptance Criteria before review.'));
  } else if (criteria.length > 0) {
    const checked = criteria.filter(evidenceChecked).length;
    if (checked < criteria.length) {
      checks.push(warn('acceptance', `${criteria.length - checked} acceptance criterion item${criteria.length - checked === 1 ? '' : 's'} unchecked`, `${checked}/${criteria.length} checked.`));
    } else {
      checks.push(pass('acceptance', 'Acceptance criteria checked', `${criteria.length} item${criteria.length === 1 ? '' : 's'} checked.`));
    }
  }

  if (ticket.build) {
    const status = String(ticket.build.status || '').toUpperCase();
    if (['FAILURE', 'FAILED', 'ERROR'].includes(status)) {
      checks.push(fail('build', `Build #${ticket.build.number} failed`, ticket.build.url || 'No build URL recorded.'));
    } else if (['SUCCESS', 'PASSED', 'OK'].includes(status)) {
      checks.push(pass('build', `Build #${ticket.build.number} passed`, ticket.build.url || 'Build URL not recorded.'));
    } else {
      checks.push(warn('build', `Build #${ticket.build.number} is ${ticket.build.status}`, ticket.build.url || 'Build is not final.'));
    }
  } else if (reviewReady) {
    checks.push(warn('build', 'No build recorded', 'Attach Jenkins/build evidence if this change has a build gate.'));
  }

  if (ticket.next_action === 'await_review') {
    if (!ticket.mr) {
      checks.push(fail('mr', 'No merge request linked', 'Review-ready tickets should have a linked MR.'));
    } else if (ticket.mr.review_status === 'changes_requested') {
      checks.push(fail('mr', `MR !${ticket.mr.iid} has changes requested`, ticket.mr.url));
    } else if (ticket.mr.review_status === 'approved') {
      checks.push(pass('mr', `MR !${ticket.mr.iid} approved`, ticket.mr.url));
    } else {
      checks.push(warn('mr', `MR !${ticket.mr.iid} pending review`, ticket.mr.url));
    }
  }

  const riskNotes = [
    ...notes.filter(note => evidenceString(note, 'kind') === 'risk'),
    ...evidenceRiskNotes(ticket),
  ];
  if (riskNotes.length > 0) {
    checks.push(warn('risk', `${riskNotes.length} risk note${riskNotes.length === 1 ? '' : 's'} recorded`, 'Review risk notes before handoff.'));
  }

  const status = checks.some(check => check.status === 'fail')
    ? 'fail'
    : checks.some(check => check.status === 'warn')
      ? 'warn'
      : 'pass';
  const failures = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warn').length;
  return {
    ticketKey,
    status,
    ready: status !== 'fail',
    checks,
    summary: `${failures} failing, ${warnings} warning, ${checks.length - failures - warnings} passing`,
  };
}

export function evaluateEvidenceGates(tickets: Record<string, Ticket>): EvidenceGateResult[] {
  return Object.entries(tickets).map(([ticketKey, ticket]) => evaluateEvidenceGate(ticketKey, ticket));
}

function pass(kind: EvidenceGateCheckKind, title: string, detail: string): EvidenceGateCheck {
  return { kind, status: 'pass', title, detail };
}

function warn(kind: EvidenceGateCheckKind, title: string, detail: string): EvidenceGateCheck {
  return { kind, status: 'warn', title, detail };
}

function fail(kind: EvidenceGateCheckKind, title: string, detail: string): EvidenceGateCheck {
  return { kind, status: 'fail', title, detail };
}
