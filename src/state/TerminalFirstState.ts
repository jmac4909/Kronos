import * as fs from 'fs';
import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot } from './types';
import { STATE_FILE, emptyWorkCatalog, readStateFileWithIssues, writeStateFile } from '../services/stateStore';
import { boundedOperationFailure } from '../services/errorUtils';
import { jiraRestClient, resolveJiraRestConfig } from '../services/jiraRestClient';
import { catalogFromJiraWorkList } from '../services/jiraWorkCatalog';
import {
  projectTicketProviderState,
  renameLocalProjectDisplayName,
  registerLocalProject,
  replaceRegisteredLocalProjects,
  setLocalProjectIntegrations,
  setLocalProjectSonarTarget,
  setTicketLocalProject,
  type LocalProjectIntegrationInput,
  type TicketProviderStateInput,
} from '../services/projectCatalog';
import {
  idleJiraWorkRefreshStatus,
  type JiraWorkRefreshStatus,
} from '../services/workRefreshStatus';

export interface TerminalFirstStateIssue {
  filePath: string;
  detail: string;
}

export interface TerminalFirstRefreshResult {
  ticketCount: number;
  complete: boolean;
  retainedFromPrevious: number;
  pageCount: number;
  responseBytes: number;
  warnings: string[];
}

export interface TerminalFirstRefreshOptions {
  signal?: AbortSignal;
}

/**
 * The terminal-first product consumes only the bounded Jira Work catalog and
 * explicit project/provider bindings needed by the terminal-first product.
 */
export class TerminalFirstState implements vscode.Disposable {
  private snapshot: KronosStateSnapshot | null = null;
  private issues: TerminalFirstStateIssue[] = [];
  private refreshSnapshot: JiraWorkRefreshStatus = idleJiraWorkRefreshStatus();
  private refreshGeneration = 0;
  private watcher: fs.FSWatcher | undefined;
  private watchTimer: NodeJS.Timeout | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.load();
    this.startWatcher();
  }

  get state(): KronosStateSnapshot | null {
    return this.snapshot;
  }

  get loadIssues(): TerminalFirstStateIssue[] {
    return this.issues.map(issue => ({ ...issue }));
  }

  get jiraRefreshStatus(): JiraWorkRefreshStatus {
    return { ...this.refreshSnapshot };
  }

  load(): void {
    try {
      const result = readStateFileWithIssues();
      this.snapshot = result.state;
      this.issues = result.issues.map(issue => ({
        filePath: issue.filePath,
        detail: issue.detail,
      }));
    } catch (error: unknown) {
      this.snapshot = null;
      this.issues = [{
        filePath: STATE_FILE,
        detail: boundedOperationFailure(error, 'Could not load Kronos ticket state.').display,
      }];
    }
  }

  reloadAndNotify(): void {
    this.load();
    this.restartWatcher();
    this.changeEmitter.fire();
  }

  async refreshTickets(options: TerminalFirstRefreshOptions = {}): Promise<TerminalFirstRefreshResult> {
    const generation = ++this.refreshGeneration;
    const startedAt = new Date().toISOString();
    this.refreshSnapshot = {
      phase: 'loading',
      startedAt,
      retainedFromPrevious: 0,
      warningCount: 0,
    };
    this.changeEmitter.fire();
    try {
      const snapshot = await jiraRestClient.searchWorkList(options);
      if (generation !== this.refreshGeneration || options.signal?.aborted) {
        throw new Error('Jira refresh was superseded by a newer operator request.');
      }
      const current = this.snapshot || emptyWorkCatalog();
      const next = catalogFromJiraWorkList(snapshot, current, resolveJiraRestConfig().baseUrl);
      writeStateFile(next.state);
      this.load();
      this.restartWatcher();
      const complete = snapshot.complete && snapshot.warnings.length === 0;
      this.refreshSnapshot = {
        phase: complete ? 'complete' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        retainedFromPrevious: next.retainedFromPrevious,
        warningCount: snapshot.warnings.length,
      };
      this.changeEmitter.fire();
      return {
        ticketCount: Object.keys(next.state.tickets).length,
        complete: snapshot.complete,
        retainedFromPrevious: next.retainedFromPrevious,
        pageCount: snapshot.pageCount,
        responseBytes: snapshot.responseBytes,
        warnings: [...snapshot.warnings],
      };
    } catch (error: unknown) {
      if (generation === this.refreshGeneration && !options.signal?.aborted) {
        this.refreshSnapshot = {
          phase: 'error',
          startedAt,
          completedAt: new Date().toISOString(),
          detail: boundedOperationFailure(error, 'Jira ticket refresh failed.').display,
          retainedFromPrevious: 0,
          warningCount: 0,
        };
        this.changeEmitter.fire();
      }
      throw error;
    }
  }

  registerLocalProject(projectName: string, projectPath: string): void {
    const next = registerLocalProject(this.snapshot || emptyWorkCatalog(), projectName, projectPath);
    writeStateFile(next);
    this.reloadAndNotify();
  }

  registerLocalProjects(projects: readonly { name: string; path: string }[]): void {
    let next = this.snapshot || emptyWorkCatalog();
    for (const project of projects) {
      next = registerLocalProject(next, project.name, project.path);
    }
    writeStateFile(next);
    this.reloadAndNotify();
  }

  replaceRegisteredLocalProjects(projects: readonly { name: string; path: string }[]): void {
    const next = replaceRegisteredLocalProjects(this.snapshot || emptyWorkCatalog(), projects);
    writeStateFile(next);
    this.reloadAndNotify();
  }

  renameLocalProjectDisplayName(projectName: string, displayName: string): void {
    const current = this.snapshot || emptyWorkCatalog();
    const next = renameLocalProjectDisplayName(current, projectName, displayName);
    if (next === current) { return; }
    writeStateFile(next);
    this.reloadAndNotify();
  }

  setLocalProjectIntegrations(values: readonly LocalProjectIntegrationInput[]): void {
    const next = setLocalProjectIntegrations(this.snapshot || emptyWorkCatalog(), values);
    writeStateFile(next);
    this.reloadAndNotify();
  }

  setTicketLocalProject(ticketKey: string, projectName?: string): void {
    const next = setTicketLocalProject(this.snapshot || emptyWorkCatalog(), ticketKey, projectName);
    writeStateFile(next);
    this.reloadAndNotify();
  }

  projectTicketProviderState(ticketKey: string, input: TicketProviderStateInput): void {
    const current = this.snapshot || emptyWorkCatalog();
    const next = projectTicketProviderState(current, ticketKey, input);
    if (next === current) { return; }
    writeStateFile(next);
    this.reloadAndNotify();
  }

  setLocalProjectSonarTarget(projectName: string, projectKey: string, branch?: string): void {
    const current = this.snapshot || emptyWorkCatalog();
    const next = setLocalProjectSonarTarget(current, projectName, projectKey, branch);
    if (next === current) { return; }
    writeStateFile(next);
    this.reloadAndNotify();
  }

  dispose(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    this.watcher?.close();
    this.watcher = undefined;
    this.changeEmitter.dispose();
  }

  private startWatcher(): void {
    if (this.watcher || !fs.existsSync(STATE_FILE)) { return; }
    try {
      this.watcher = fs.watch(STATE_FILE, () => {
        if (this.watchTimer) { clearTimeout(this.watchTimer); }
        this.watchTimer = setTimeout(() => {
          this.watchTimer = undefined;
          this.load();
          this.refreshSnapshot = idleJiraWorkRefreshStatus();
          this.restartWatcher();
          this.changeEmitter.fire();
        }, 150);
      });
    } catch (error: unknown) {
      console.warn(boundedOperationFailure(error, 'Could not watch the local Work catalog.').display);
    }
  }

  private restartWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.startWatcher();
  }
}
