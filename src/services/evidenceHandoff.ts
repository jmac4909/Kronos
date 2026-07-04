import { Ticket } from '../state/types';
import { EvidenceExport, formatEvidenceComment } from './evidenceStore';

type EvidenceDestinationKind = 'jira' | 'mr' | 'file';

interface EvidenceDestination {
  kind: EvidenceDestinationKind;
  label: string;
  available: boolean;
  url?: string;
  detail: string;
  comment?: string;
}

export interface EvidenceHandoffPlan {
  ticketKey: string;
  summary: string;
  destinations: EvidenceDestination[];
  exportPath: string;
  comment: string;
  manualSteps: string[];
}

export function buildEvidenceHandoffPlan(ticketKey: string, ticket: Ticket, exported: EvidenceExport): EvidenceHandoffPlan {
  const comment = exported.comment || formatEvidenceComment(ticketKey, ticket);
  const destinations: EvidenceDestination[] = [
    evidenceDestination(
      'jira',
      'Jira ticket comment',
      Boolean(ticket.jira_url),
      ticket.jira_url,
      ticket.jira_url ? 'Open Jira and paste the copied evidence comment.' : 'No Jira URL is recorded for this ticket.',
      comment,
    ),
    evidenceDestination(
      'mr',
      'Merge request comment',
      Boolean(ticket.mr?.url),
      ticket.mr?.url,
      ticket.mr?.url ? `Open MR !${ticket.mr.iid} and paste the copied evidence comment.` : 'No merge request URL is recorded for this ticket.',
      comment,
    ),
    {
      kind: 'file',
      label: 'Markdown evidence artifact',
      available: true,
      detail: `Evidence markdown written to ${exported.filePath}.`,
    },
  ];

  return {
    ticketKey,
    summary: ticket.summary || '',
    destinations,
    exportPath: exported.filePath,
    comment,
    manualSteps: [
      'Review the generated evidence comment for secrets or environment-specific data.',
      'Paste the comment into each available Jira/MR destination that needs an audit trail.',
      'Keep the markdown artifact as the durable local evidence record.',
    ],
  };
}

function evidenceDestination(kind: EvidenceDestinationKind, label: string, available: boolean, url: string | undefined, detail: string, comment: string): EvidenceDestination {
  const destination: EvidenceDestination = { kind, label, available, detail, comment };
  if (url) { destination.url = url; }
  return destination;
}
