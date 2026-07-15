import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const PROJECT_INTEGRATION_SCRIPT = 'kronos-project-integration.js';

export interface ProjectIntegrationFormProject {
  name: string;
  displayName?: string;
  path: string;
  branch?: string;
  gitlabProject?: string;
  jenkinsUrl?: string;
  sonarProjectKey?: string;
  defaultBranch?: string;
  branchProfiles?: string;
  activeBranchProfile?: string;
}

export interface ProjectIntegrationPanelInput {
  projects: ProjectIntegrationFormProject[];
  providerReadiness: Array<{ name: string; ready: boolean; detail: string }>;
  nonce: string;
  scriptUri: string;
}

export function buildProjectIntegrationPanelHtml(input: ProjectIntegrationPanelInput): string {
  const readiness = input.providerReadiness.map(provider => `<div class="provider-readiness ${provider.ready ? 'pass' : 'warn'}">
    <span class="status-dot" aria-hidden="true"></span>
    <div><strong>${escapeHtml(provider.name)}</strong><span>${escapeHtml(provider.detail)}</span></div>
  </div>`).join('');
  const projectCards = input.projects.slice(0, 200).map(project => `<section class="integration-card" data-project-card data-project-name="${escapeAttr(project.name)}">
    <header>
      <div><h2>${escapeHtml(project.displayName || project.name)}</h2><div class="project-path">${escapeHtml(project.path)}</div></div>
      <span class="kronos-pill info">${escapeHtml(project.branch || 'branch unavailable')}</span>
    </header>
    <div class="field-grid">
      ${formField('GitLab project ID or path', 'gitlabProject', project.gitlabProject || '', '12345 or group/project', 'Used to read merge requests, review discussions, pipelines, jobs, and test reports.')}
      ${formField('Jenkins job URL', 'jenkinsUrl', project.jenkinsUrl || '', 'https://jenkins.example/job/team/job/service/', 'Use the job URL Kronos should poll for builds, stages, and tests.')}
      ${formField('SonarQube project key', 'sonarProjectKey', project.sonarProjectKey || '', 'team:service', 'The component key used for quality gates, measures, and issues.')}
      ${formField('Default monitoring branch', 'defaultBranch', project.defaultBranch || project.branch || '', 'main', 'Used by SonarQube until a linked merge request supplies its source branch.')}
      ${formField('Active branch profile', 'activeBranchProfile', project.activeBranchProfile || '', 'release/2026.07', 'Optional exact fallback profile. A linked MR branch selects its own exact profile first.')}
      ${formTextarea('Jenkins / SonarQube branch profiles', 'branchProfiles', project.branchProfiles || '', 'branch | Jenkins job URL | SonarQube key | SonarQube branch', 'One explicit profile per line, up to 20. Blank provider columns are allowed, but each line must configure Jenkins, SonarQube, or both. Profiles route reads only; they never switch Git branches.')}
    </div>
  </section>`).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-project-integration-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="project-integration" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');

  return `<!DOCTYPE html>
<html><head><style>
${kronosWebviewBaseCss()}
.integration-shell { max-width: 1120px; }
.integration-header { align-items: center; }
.readiness-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-bottom: 16px; }
.provider-readiness { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 9px; padding: 11px 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
.provider-readiness .status-dot { width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--k-warn); }
.provider-readiness.pass .status-dot { background: var(--k-ok); }
.provider-readiness strong, .provider-readiness span { display: block; }
.provider-readiness span { margin-top: 2px; color: var(--k-muted); font-size: 11px; line-height: 1.4; }
.integration-list { display: grid; gap: 12px; }
.integration-card { padding: 16px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.integration-card > header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.integration-card h2 { margin: 0; font-size: 15px; }
.project-path { margin-top: 3px; color: var(--k-muted); font-size: 11px; word-break: break-all; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.form-field label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 650; }
.form-field input { width: 100%; }
.form-field textarea { width: 100%; min-height: 112px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
.form-field.wide { grid-column: 1 / -1; }
.field-help { margin-top: 4px; color: var(--k-muted); font-size: 10px; line-height: 1.35; }
.integration-actions { position: sticky; bottom: 0; z-index: 2; margin-top: 16px; padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: color-mix(in srgb, var(--k-bg) 92%, transparent); backdrop-filter: blur(8px); }
.privacy-copy { margin-left: auto; color: var(--k-muted); font-size: 11px; }
@media (max-width: 760px) { .readiness-grid, .field-grid { grid-template-columns: 1fr; } .privacy-copy { width: 100%; margin-left: 0; } }
</style></head>
<body><main class="kronos-shell integration-shell">
  <header class="kronos-header integration-header">
    <div>
      <h1 class="kronos-title">Project Integration Setup</h1>
      <div class="kronos-subtitle">Map registered folders to the identifiers Kronos needs for read-only MR, pipeline, Jenkins, and SonarQube polling.</div>
    </div>
    <span class="kronos-pill info">Local config only</span>
  </header>
  <section class="readiness-grid">${readiness}</section>
  <div class="message warn">Provider credentials stay in the private Kronos environment file. This form saves only project identifiers, job URLs, explicit branch routing profiles, and the default branch; it never switches Git, tests, changes, or posts to a provider.</div>
  <section class="integration-list">${projectCards || '<div class="kronos-empty">No registered local projects are available to configure.</div>'}</section>
  <div class="kronos-action-row integration-actions">
    <button type="button" class="kronos-button primary" data-action="save">Save Project Setup</button>
    <button type="button" class="kronos-button" data-action="cancel">Not Now</button>
    <span class="privacy-copy">Blank fields clear that optional integration. Ctrl+Enter saves.</span>
  </div>
</main>
${script}
</body></html>`;
}

function formField(label: string, field: string, value: string, placeholder: string, help: string): string {
  return `<div class="form-field">
    <label>${escapeHtml(label)}
      <input class="kronos-input" type="text" data-field="${escapeAttr(field)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off" spellcheck="false">
    </label>
    <div class="field-help">${escapeHtml(help)}</div>
  </div>`;
}

function formTextarea(label: string, field: string, value: string, placeholder: string, help: string): string {
  return `<div class="form-field wide">
    <label>${escapeHtml(label)}
      <textarea class="kronos-input" data-field="${escapeAttr(field)}" maxlength="20000" placeholder="${escapeAttr(placeholder)}" spellcheck="false">${escapeHtml(value)}</textarea>
    </label>
    <div class="field-help">${escapeHtml(help)}</div>
  </div>`;
}
