export type WorkRefreshRunResult<T> =
  | { kind: 'complete'; value: T }
  | { kind: 'coalesced' }
  | { kind: 'superseded' };

/**
 * Owns the one Work-refresh concurrency rule without knowing about VS Code UI
 * or Jira persistence. Scheduled reads coalesce; a newer explicit operator
 * read aborts and supersedes the prior read.
 */
export class WorkRefreshCoordinator<T> {
  private current: AbortController | undefined;

  constructor(private readonly read: (signal: AbortSignal) => PromiseLike<T>) {}

  async run(explicit: boolean): Promise<WorkRefreshRunResult<T>> {
    if (this.current) {
      if (!explicit) { return { kind: 'coalesced' }; }
      this.current.abort();
    }
    const controller = new AbortController();
    this.current = controller;
    try {
      const value = await this.read(controller.signal);
      return controller.signal.aborted
        ? { kind: 'superseded' }
        : { kind: 'complete', value };
    } catch (error: unknown) {
      if (controller.signal.aborted) { return { kind: 'superseded' }; }
      throw error;
    } finally {
      if (this.current === controller) { this.current = undefined; }
    }
  }

  dispose(): void {
    this.current?.abort();
    this.current = undefined;
  }
}
