import { recordFromUnknown, recordString } from './records';

export interface TicketWorkspaceActionMessage {
  command: string;
  ticket: string;
}

export interface OperationsActionMessage {
  command: string;
}

export type ContextComposerMessage =
  | { command: 'insertDraft'; focus: string }
  | { command: 'openArtifact' | 'cancel' };

export type ProjectIntegrationMessage =
  | { command: 'cancel' }
  | {
    command: 'save';
    projects: Array<{
      name: string;
      gitlabProject: string;
      jenkinsUrl: string;
      sonarProjectKey: string;
      defaultBranch: string;
    }>;
  };

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

export function normalizeOperationsActionMessage(
  raw: unknown,
  allowed: ReadonlySet<string>,
): OperationsActionMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  return typeof command === 'string' && allowed.has(command) ? { command } : null;
}

export function normalizeContextComposerMessage(raw: unknown): ContextComposerMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  if (command === 'openArtifact' || command === 'cancel') { return { command }; }
  if (command !== 'insertDraft' || typeof message['focus'] !== 'string' || message['focus'].length > 4_000) {
    return null;
  }
  return { command, focus: message['focus'] };
}

export function normalizeProjectIntegrationMessage(raw: unknown): ProjectIntegrationMessage | null {
  const message = recordFromUnknown(raw);
  if (message['command'] === 'cancel') { return { command: 'cancel' }; }
  if (message['command'] !== 'save' || !Array.isArray(message['projects']) || message['projects'].length > 100) {
    return null;
  }
  const projects = [];
  for (const value of message['projects']) {
    const project = recordFromUnknown(value);
    const name = boundedMessageString(project['name'], 200);
    const gitlabProject = boundedMessageString(project['gitlabProject'], 512, true);
    const jenkinsUrl = boundedMessageString(project['jenkinsUrl'], 4_000, true);
    const sonarProjectKey = boundedMessageString(project['sonarProjectKey'], 400, true);
    const defaultBranch = boundedMessageString(project['defaultBranch'], 500, true);
    if (name === null || gitlabProject === null || jenkinsUrl === null || sonarProjectKey === null || defaultBranch === null) {
      return null;
    }
    projects.push({ name, gitlabProject, jenkinsUrl, sonarProjectKey, defaultBranch });
  }
  return { command: 'save', projects };
}

function boundedMessageString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value.length > maxLength) { return null; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized) { return normalized; }
  return allowEmpty ? '' : null;
}
