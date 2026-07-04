import { Ticket } from '../state/types';

type EvidenceRecord = object;

export function evidenceNotes(ticket: Ticket): EvidenceRecord[] {
  return arrayRecords(ticket.evidence?.notes);
}

export function evidenceAcceptanceCriteria(ticket: Ticket): EvidenceRecord[] {
  return arrayRecords(ticket.evidence?.acceptance_criteria);
}

export function evidenceChecks(ticket: Ticket): EvidenceRecord[] {
  return arrayRecords(ticket.evidence?.checks);
}

export function evidenceRiskNotes(ticket: Ticket): EvidenceRecord[] {
  return arrayRecords(ticket.evidence?.risk_notes);
}

export function evidenceEnvironmentResults(ticket: Ticket): EvidenceRecord[] {
  const value = ticket.evidence?.environment_results;
  if (!isEvidenceRecord(value)) { return []; }
  return Object.values(value).filter(isEvidenceRecord);
}

export function evidenceRecordCount(ticket: Ticket | null | undefined): number {
  if (!ticket) { return 0; }
  return evidenceNotes(ticket).length + evidenceChecks(ticket).length + evidenceEnvironmentResults(ticket).length;
}

export function evidenceString(record: EvidenceRecord | null | undefined, key: string, fallback = ''): string {
  const value = record ? Reflect.get(record, key) : undefined;
  return typeof value === 'string' ? value.trim() : fallback;
}

export function evidenceChecked(record: EvidenceRecord): boolean {
  return Reflect.get(record, 'checked') === true;
}

function arrayRecords(value: unknown): EvidenceRecord[] {
  return Array.isArray(value) ? value.filter(isEvidenceRecord) : [];
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
