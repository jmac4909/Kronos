export interface ProjectRegistryEntry {
  path?: string | undefined;
}

export interface ProjectSelectionItem {
  label: string;
  description?: string;
}

export interface ProjectTicket {
  key: string;
  projects: string[];
}

export function buildRegisteredProjectItems(projects: Record<string, ProjectRegistryEntry> | undefined): ProjectSelectionItem[] {
  return Object.entries(projects || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, project]) => ({ label, description: project.path || '' }));
}

export function buildTicketProjectItems(
  projectNames: string[],
  projects: Record<string, ProjectRegistryEntry> | undefined,
): ProjectSelectionItem[] {
  return projectNames.map(projectName => ({
    label: projectName,
    description: projects?.[projectName]?.path || 'Project is not registered',
  }));
}

export function groupTicketsByProject<T extends ProjectTicket>(tickets: T[]): Record<string, T[]> {
  const byProject: Record<string, T[]> = {};
  for (const ticket of tickets) {
    for (const projectName of ticket.projects) {
      const bucket = byProject[projectName] || [];
      if (!bucket.some(candidate => candidate.key === ticket.key)) { bucket.push(ticket); }
      byProject[projectName] = bucket;
    }
  }
  return byProject;
}

export function buildTicketGroupProjectItems<T extends ProjectTicket>(
  byProject: Record<string, T[]>,
  countLabel: string,
): ProjectSelectionItem[] {
  return Object.keys(byProject).map(projectName => ({
    label: projectName,
    description: `${(byProject[projectName] || []).length} ${countLabel}`,
  }));
}
