import type { WorkCompletionFilter, WorkTicketFilter, WorkTicketFilterOptions } from '../services/workTicketFilters';

export interface WorkFilterChoice {
  label: string;
  description?: string;
  id?: 'query' | 'completion' | 'status' | 'jiraProject' | 'localProject' | 'label' | 'clear';
  value?: string;
}

export interface WorkFilterFlowUi {
  pick(items: readonly WorkFilterChoice[], options: { title: string; placeHolder?: string }): PromiseLike<WorkFilterChoice | undefined>;
  input(options: { title: string; prompt: string; value: string }): PromiseLike<string | undefined>;
}

export interface WorkFilterFlowInput {
  current: WorkTicketFilter;
  options: WorkTicketFilterOptions;
  defaultCompletion: 'active' | 'all';
  ui: WorkFilterFlowUi;
  setFilter(filter: WorkTicketFilter): void;
  clearFilter(): void;
}

/** Owns the bounded multi-step Work filter interaction independently of VS Code activation. */
export async function configureWorkFilterFlow(input: WorkFilterFlowInput): Promise<void> {
  const { current, options, ui } = input;
  const workState = current.jiraStatus
    ? `Status: ${current.jiraStatus}`
    : workCompletionLabel(current.completion || input.defaultCompletion);
  const selection = await ui.pick([
    { label: '$(search) Search', description: current.query || 'Any text', id: 'query' },
    { label: '$(issue-opened) Work state', description: workState, id: 'completion' },
    { label: '$(list-filter) Jira status', description: current.jiraStatus || 'Any active status', id: 'status' },
    { label: '$(issues) Jira project', description: current.jiraProject || 'All Jira projects', id: 'jiraProject' },
    { label: '$(repo) Local project', description: current.localProject || 'All local projects', id: 'localProject' },
    { label: '$(tag) Label', description: current.label || 'All labels', id: 'label' },
    { label: '$(clear-all) Clear all filters', description: 'Show the default Work view', id: 'clear' },
  ], { title: 'Filter Work', placeHolder: 'Choose what to filter' });
  if (!selection) { return; }
  if (selection.id === 'clear') {
    input.clearFilter();
    return;
  }
  if (selection.id === 'query') {
    const query = await ui.input({
      title: 'Search Work',
      prompt: 'Match ticket keys, summaries, statuses, labels, projects, merge requests, and builds',
      value: current.query || '',
    });
    if (query !== undefined) { input.setFilter({ ...current, query }); }
    return;
  }
  if (selection.id === 'completion') {
    const completion = await ui.pick([
      { label: 'Active', description: 'Hide completed tickets', value: 'active' },
      { label: 'Completed', description: 'Show only completed tickets', value: 'completed' },
      { label: 'All', description: 'Show active and completed tickets', value: 'all' },
    ], { title: 'Choose Work State' });
    if (isWorkCompletionFilter(completion?.value)) {
      const next = { ...current, completion: completion.value };
      delete next.jiraStatus;
      input.setFilter(next);
    }
    return;
  }
  if (selection.id === 'status') {
    const status = await ui.pick([
      { label: 'Any active status', value: '' },
      ...options.jiraStatuses.map(value => ({ label: value, value })),
    ], { title: 'Filter by Jira status' });
    if (status?.value !== undefined) {
      const next = { ...current };
      if (status.value) {
        next.jiraStatus = status.value;
        next.completion = 'all';
      } else {
        delete next.jiraStatus;
        next.completion = 'active';
      }
      input.setFilter(next);
    }
    return;
  }
  const facet = selection.id === 'label'
    ? await ui.pick([
      { label: 'All labels', value: '' },
      ...options.labels.map(value => ({ label: value, value })),
    ], { title: 'Filter by label' })
    : selection.id === 'jiraProject'
      ? await ui.pick([
        { label: 'All Jira projects', value: '' },
        ...options.jiraProjects.map(value => ({ label: value, value })),
      ], { title: 'Filter by Jira project' })
      : await ui.pick([
        { label: 'All local projects', value: '' },
        ...options.localProjects.map(value => ({ label: value, value })),
      ], { title: 'Filter by local project' });
  if (facet?.value === undefined) { return; }
  const next = { ...current };
  if (selection.id === 'label') {
    if (facet.value) { next.label = facet.value; }
    else { delete next.label; }
  } else if (selection.id === 'jiraProject') {
    if (facet.value) { next.jiraProject = facet.value; }
    else { delete next.jiraProject; }
  } else if (facet.value) {
    next.localProject = facet.value;
  } else {
    delete next.localProject;
  }
  input.setFilter(next);
}

function workCompletionLabel(value: 'active' | 'completed' | 'all'): string {
  if (value === 'completed') { return 'Completed'; }
  if (value === 'all') { return 'All'; }
  return 'Active';
}

function isWorkCompletionFilter(value: string | undefined): value is WorkCompletionFilter {
  return value === 'active' || value === 'completed' || value === 'all';
}
