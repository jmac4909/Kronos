export interface ProjectSetupPromptInput {
  projectName: string;
  projectPath: string;
  gitlabProjectId: number | null;
  sonarProjectKey: string | null;
}

export function projectSetupConfirmation(projectName: string): string {
  return `Set up ${projectName}? This will configure Kronos project metadata and inspect GitLab/SonarQube settings.`;
}

export function buildProjectSetupPrompt(input: ProjectSetupPromptInput): string {
  return `Set up project ${input.projectName} at ${input.projectPath}. Do these things:

1. Read the pom.xml for artifactId, groupId, parent, dependencies, build profiles
2. Read src/main/resources/application*.yml for datasources, ports, profiles
3. Inspect existing build, run, mock server, API endpoint, test data, and SonarQube config files
4. Do not create or edit CLAUDE.md or other documentation files in this setup pass
5. Do NOT touch .claude/project.json - it has already been configured with gitlab_project_id=${input.gitlabProjectId} and sonar_project_key=${input.sonarProjectKey}
6. Report the discovered build/run/test commands and any missing integration settings`;
}
