import * as fs from 'fs';
import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot } from './types';
import { STATE_FILE, emptyWorkCatalog, readStateFileWithIssues, writeStateFile } from '../services/stateStore';
import { unknownErrorMessage } from '../services/errorUtils';
import { jiraRestClient, resolveJiraRestConfig } from '../services/jiraRestClient';
import { catalogFromJiraWorkList } from '../services/jiraWorkCatalog';
import {
  projectTicketProviderState,
  registerLocalProject,
  replaceRegisteredLocalProjects,
  setLocalProjectIntegrations,
  setLocalProjectSonarTarget,
  setTicketLocalProject,
  type LocalProjectIntegrationInput,
  type TicketProviderStateInput,
} from '../services/projectCatalog';

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

/**
 * The terminal-first product consumes only the bounded Jira Work catalog and
 * explicit project/provider bindings needed by the terminal-first product.
 */
export class TerminalFirstState implements vscode.Disposable {
  private snapshot: KronosStateSnapshot | null = null;
  private issues: TerminalFirstStateIssue[] = [];
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
        detail: unknownErrorMessage(error, 'Could not load Kronos ticket state.'),
      }];
    }
  }

  reloadAndNotify(): void {
    this.load();
    this.restartWatcher();
    this.changeEmitter.fire();
  }

  async refreshTickets(): Promise<TerminalFirstRefreshResult> {
    const snapshot = await jiraRestClient.searchWorkList();
    const current = this.snapshot || emptyWorkCatalog();
    const next = catalogFromJiraWorkList(snapshot, current, resolveJiraRestConfig().baseUrl);
    writeStateFile(next.state);
    this.reloadAndNotify();
    return {
      ticketCount: Object.keys(next.state.tickets).length,
      complete: snapshot.complete,
      retainedFromPrevious: next.retainedFromPrevious,
      pageCount: snapshot.pageCount,
      responseBytes: snapshot.responseBytes,
      warnings: [...snapshot.warnings],
    };
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
          this.restartWatcher();
          this.changeEmitter.fire();
        }, 150);
      });
    } catch (error: unknown) {
      console.warn(unknownErrorMessage(error, `Could not watch ${STATE_FILE}.`));
    }
  }

  private restartWatcher(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.startWatcher();
  }
}
