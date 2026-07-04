import { OPERATOR_COMMAND_TO_VSCODE_COMMAND, TICKET_SCOPED_OPERATOR_COMMANDS } from './webviewCommandRegistry';

export interface OperatorCommandRouteInput {
  command: string;
  ticketKey?: string;
  runId?: string;
  itemId?: string;
}

export type OperatorCommandRoute =
  | { kind: 'unknown' }
  | { kind: 'missingTicket'; commandId: string }
  | { kind: 'execute'; commandId: string; argument?: OperatorCommandArgument };

export interface OperatorCommandArgument {
  ticketKey?: string;
  runId?: string;
  itemId?: string;
}

export function isTicketOperatorCommand(command: string): boolean {
  return TICKET_SCOPED_OPERATOR_COMMANDS.has(command) || command === 'evidenceGate';
}

export function resolveOperatorCommandRoute(input: OperatorCommandRouteInput): OperatorCommandRoute {
  const commandId = OPERATOR_COMMAND_TO_VSCODE_COMMAND.get(input.command);
  if (!commandId) {
    return { kind: 'unknown' };
  }
  const ticketKey = input.ticketKey || '';
  if (TICKET_SCOPED_OPERATOR_COMMANDS.has(input.command)) {
    if (!ticketKey) {
      return { kind: 'missingTicket', commandId };
    }
    return { kind: 'execute', commandId, argument: { ticketKey } };
  }
  if (input.command === 'evidenceGate' && ticketKey) {
    return { kind: 'execute', commandId, argument: { ticketKey } };
  }
  if ((input.command === 'runCenter' || input.command === 'recoveryCenter') && (input.runId || input.itemId)) {
    return {
      kind: 'execute',
      commandId,
      argument: {
        runId: input.runId || '',
        itemId: input.itemId || '',
      },
    };
  }
  return { kind: 'execute', commandId };
}
