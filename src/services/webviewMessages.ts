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
  | { command: 'openArtifact' }
  | { command: 'addToBasket' }
  | { command: 'cancel' };

export type ContextBasketMessage =
  | { command: 'insert'; focus: string }
  | { command: 'remove' | 'refresh'; entryId: string; focus: string }
  | { command: 'clear'; focus: string }
  | { command: 'close' };

export type PromptLibraryComposerMessage =
  | { command: 'insertPrompt'; body: string }
  | { command: 'openSettings' }
  | { command: 'cancel' };

export type ProjectIntegrationMessage =
  | { command: 'cancel' }
  | {
    command: 'save';
    projects: Array<{
      name: string;
      nickname: string;
      gitlabProject: string;
      jenkinsUrl: string;
      sonarProjectKey: string;
      defaultBranch: string;
      branchProfiles: string;
      activeBranchProfile: string;
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
  if (command === 'openArtifact' || command === 'addToBasket' || command === 'cancel') { return { command }; }
  if (command !== 'insertDraft' || typeof message['focus'] !== 'string' || message['focus'].length > 4_000) {
    return null;
  }
  return { command, focus: message['focus'] };
}

export function normalizeContextBasketMessage(raw: unknown): ContextBasketMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  if (command === 'close') { return { command }; }
  if (command === 'clear') {
    return typeof message['focus'] === 'string' && message['focus'].length <= 4_000
      ? { command, focus: message['focus'] }
      : null;
  }
  if (command === 'insert') {
    return typeof message['focus'] === 'string' && message['focus'].length <= 4_000
      ? { command, focus: message['focus'] }
      : null;
  }
  if (command !== 'remove' && command !== 'refresh') { return null; }
  const entryId = recordString(message, 'entryId');
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/.test(entryId)
    && typeof message['focus'] === 'string' && message['focus'].length <= 4_000
    ? { command, entryId, focus: message['focus'] }
    : null;
}

export function normalizePromptLibraryComposerMessage(raw: unknown): PromptLibraryComposerMessage | null {
  const message = recordFromUnknown(raw);
  const command = message['command'];
  if (command === 'openSettings' || command === 'cancel') { return { command }; }
  if (command !== 'insertPrompt' || typeof message['body'] !== 'string' || message['body'].length > 20_000) {
    return null;
  }
  return { command, body: message['body'] };
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
    const nickname = boundedMessageString(project['nickname'], 200, true);
    const gitlabProject = boundedMessageString(project['gitlabProject'], 512, true);
    const jenkinsUrl = boundedMessageString(project['jenkinsUrl'], 4_000, true);
    const sonarProjectKey = boundedMessageString(project['sonarProjectKey'], 400, true);
    const defaultBranch = boundedMessageString(project['defaultBranch'], 500, true);
    const branchProfiles = boundedMultilineMessageString(project['branchProfiles'], 20_000);
    const activeBranchProfile = boundedMessageString(project['activeBranchProfile'], 500, true);
    if (name === null || nickname === null || gitlabProject === null || jenkinsUrl === null || sonarProjectKey === null
      || defaultBranch === null || branchProfiles === null || activeBranchProfile === null) {
      return null;
    }
    projects.push({
      name,
      nickname,
      gitlabProject,
      jenkinsUrl,
      sonarProjectKey,
      defaultBranch,
      branchProfiles,
      activeBranchProfile,
    });
  }
  return { command: 'save', projects };
}

function boundedMessageString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value.length > maxLength) { return null; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized) { return normalized; }
  return allowEmpty ? '' : null;
}

function boundedMultilineMessageString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length > maxLength) { return null; }
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();
}
