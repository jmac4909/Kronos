import { recordFromUnknown, recordString } from './records';

export interface TicketWorkspaceActionMessage {
  command: string;
  ticket: string;
}

export function normalizeActionPanelMessage(
  raw: unknown,
  allowed: ReadonlySet<string>,
): TicketWorkspaceActionMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  if (typeof command !== 'string' || !allowed.has(command)) { return null; }
  const ticket = recordString(message, 'ticket').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(ticket)) { return null; }
  return {
    command,
    ticket,
  };
}
