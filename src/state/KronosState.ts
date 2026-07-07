import * as vscode from 'vscode';
import * as fs from 'fs';
import { KronosState as KronosStateType, QueueState, ClaudeSession } from './types';
import { RenderedPrompt, renderPrompt, type RenderPromptOptions } from '../services/promptManager';
import { STATE_FILE, QUEUE_FILE, readQueueFile, readStateFileWithIssues } from '../services/stateStore';
import { ScriptRunOptions } from '../services/scriptClient';
import { DiscoverProjectsResult, MorningBriefResult, addAdhocTask, completeAdhocTask, discoverProjectsJson, readMorningBriefJson, refreshKronosState, registerProject, runStateScript } from '../services/stateScriptAdapter';
import { readClaudeAgents } from '../services/cliProbes';
import { unknownErrorMessage } from '../services/errorUtils';
import { autoExtractAcceptanceCriteriaForTickets } from '../services/ticketMutations';

interface KronosStateLoadIssue {
  target: 'state.json' | 'queue.json';
  filePath: string;
  detail: string;
}

export class KronosState {
  private _state: KronosStateType | null = null;
  private _queue: QueueState | null = null;
  private _sessions: ClaudeSession[] = [];
  private _loadIssues: KronosStateLoadIssue[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _onDidSessionChange = new vscode.EventEmitter<void>();
  readonly onDidSessionChange = this._onDidSessionChange.event;
  private _watchers: fs.FSWatcher[] = [];
  private _watchedFiles = new Set<string>();
  private _suppressWatch = false;
  private _watchDebounce: NodeJS.Timeout | undefined;
  private _suppressWatchTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.load();
    this.startWatching();
  }

  get state(): KronosStateType | null { return this._state; }
  get queue(): QueueState | null { return this._queue; }
  get sessions(): ClaudeSession[] { return this._sessions; }
  get loadIssues(): KronosStateLoadIssue[] { return [...this._loadIssues]; }

  load(): void {
    const issues: KronosStateLoadIssue[] = [];
    try {
      const result = readStateFileWithIssues();
      this._state = result.state;
      issues.push(...result.issues);
    } catch (e: unknown) {
      this._state = null;
      issues.push({
        target: 'state.json',
        filePath: STATE_FILE,
        detail: unknownErrorMessage(e, 'Failed to load state.json'),
      });
    }
    try {
      this._queue = readQueueFile();
    } catch (e: unknown) {
      this._queue = null;
      issues.push({
        target: 'queue.json',
        filePath: QUEUE_FILE,
        detail: unknownErrorMessage(e, 'Failed to load queue.json'),
      });
    }
    this._loadIssues = issues;
  }

  private startWatching(): void {
    this.watchFile(STATE_FILE);
    this.watchFile(QUEUE_FILE);
  }

  private watchFile(filepath: string): void {
    if (this._watchedFiles.has(filepath)) { return; }
    if (!fs.existsSync(filepath)) { return; }
    try {
      const watcher = fs.watch(filepath, () => {
        if (this._suppressWatch) { return; }
        clearTimeout(this._watchDebounce);
        this._watchDebounce = setTimeout(() => {
          this.load();
          this._onDidChange.fire();
        }, 150);
      });
      this._watchers.push(watcher);
      this._watchedFiles.add(filepath);
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, `Kronos file watcher failed for ${filepath}.`));
    }
  }

  ensureWatchers(): void {
    this.watchFile(STATE_FILE);
    this.watchFile(QUEUE_FILE);
  }

  async refreshSessions(): Promise<void> {
    this._sessions = readClaudeAgents<ClaudeSession>();
    this._onDidSessionChange.fire();
  }

  async runScript(args: string[], options: ScriptRunOptions = {}): Promise<string> {
    return runStateScript(args, { scriptOptions: options });
  }

  reloadAndNotify(): void {
    this.load();
    this.ensureWatchers();
    this._onDidChange.fire();
  }

  private async runAndReload<T>(operation: () => T): Promise<T> {
    this._suppressWatch = true;
    clearTimeout(this._suppressWatchTimer);
    try {
      const result = operation();
      this.reloadAndNotify();
      return result;
    } finally {
      this._suppressWatchTimer = setTimeout(() => {
        this._suppressWatch = false;
        this._suppressWatchTimer = undefined;
      }, 300);
    }
  }

  async refresh(project?: string): Promise<void> {
    await this.runAndReload(() => {
      const result = refreshKronosState(project);
      autoExtractAcceptanceCriteriaForTickets();
      return result;
    });
  }

  renderPrompt(name: string, vars: Record<string, string> = {}, projectPath?: string): RenderedPrompt | null {
    try {
      const options: RenderPromptOptions = {};
      if (projectPath) { options.projectPath = projectPath; }
      return renderPrompt(name, vars, options);
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, `Failed to render Kronos prompt ${name}.`));
      return null;
    }
  }

  loadPrompt(name: string, vars: Record<string, string> = {}, projectPath?: string): string {
    return this.renderPrompt(name, vars, projectPath)?.text || '';
  }

  async discover(): Promise<DiscoverProjectsResult> {
    return this.runAndReload(() => discoverProjectsJson());
  }

  async register(projectPath: string): Promise<string> {
    return this.runAndReload(() => registerProject(projectPath));
  }

  async addTask(title: string, description?: string): Promise<void> {
    await this.runAndReload(() => addAdhocTask(title, description));
  }

  async completeTask(taskId: string): Promise<void> {
    await this.runAndReload(() => completeAdhocTask(taskId));
  }

  async morningBrief(): Promise<MorningBriefResult> {
    return readMorningBriefJson();
  }

  dispose(): void {
    clearTimeout(this._watchDebounce);
    clearTimeout(this._suppressWatchTimer);
    this._watchers.forEach(w => w.close());
    this._onDidChange.dispose();
    this._onDidSessionChange.dispose();
  }
}
