import * as fs from 'fs';
import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot } from './types';
import { STATE_FILE, emptyWorkCatalog, readStateFileWithIssues, writeStateFile } from '../services/stateStore';
import { unknownErrorMessage } from '../services/errorUtils';
import { jiraRestClient, resolveJiraRestConfig } from '../services/jiraRestClient';
import { catalogFromJiraWorkList } from '../services/jiraWorkCatalog';

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
 * project/provider bindings needed by the three-view product.
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
