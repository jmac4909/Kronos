import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const PROJECT_INTEGRATION_SCRIPT = 'kronos-project-integration.js';

export interface ProjectIntegrationFormProject {
  name: string;
  displayName?: string;
  nickname?: string;
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
  const projectCards = input.projects.slice(0, 200).map(project => {
    const branchRoutingOpen = Boolean(project.branchProfiles?.trim() || project.activeBranchProfile?.trim());
    return `<section class="integration-card" data-project-card data-project-name="${escapeAttr(project.name)}">
    <header>
      <div><h2>${escapeHtml(project.displayName || project.name)}</h2>${project.displayName && project.displayName !== project.name ? `<div class="project-identity">Project ID: ${escapeHtml(project.name)}</div>` : ''}<div class="project-path">${escapeHtml(project.path)}</div></div>
      <span class="kronos-pill info">${escapeHtml(project.branch || 'branch unavailable')}</span>
    </header>
    <div class="field-grid">
      ${formField('Display name (optional)', 'nickname', project.nickname || '', 'Customer API', 'A friendly name shown in Kronos. Leave blank to use the repository name.', false, 200)}
      ${formField('GitLab project ID or path', 'gitlabProject', project.gitlabProject || '', '12345 or group/project', 'Used to read merge requests, review discussions, pipelines, jobs, and test reports.')}
      ${jenkinsJobUrlField(project.jenkinsUrl || '')}
      ${formField('SonarQube project key', 'sonarProjectKey', project.sonarProjectKey || '', 'team:service', 'The component key used for quality gates, measures, and issues.')}
      ${formField('Default monitoring branch', 'defaultBranch', project.defaultBranch || project.branch || '', 'main', 'The SonarQube branch Kronos reads by default. A linked merge request or SonarQube branch override may replace it; merely checking out another local branch does not.')}
    </div>
    <details class="branch-routing"${branchRoutingOpen ? ' open' : ''}>
      <summary>Branch routing <span>Optional Jenkins and SonarQube overrides</span></summary>
      <div class="branch-routing-grid">
        ${formField('Fallback profile', 'activeBranchProfile', project.activeBranchProfile || '', 'release/2026.07', 'Used only when no merge request branch matches a saved override.')}
        ${formTextarea('Branch overrides', 'branchProfiles', project.branchProfiles || '', 'feature/payments | https://jenkins.example/job/team/job/service/ | team:service | feature/payments', 'Add one branch per line, up to 20, using: branch | Jenkins job URL | SonarQube key | SonarQube branch. The Jenkins column uses the same /job/... URL shape shown above. Each line must configure Jenkins, SonarQube, or both. These overrides only route reads; they never switch Git branches.', false)}
      </div>
    </details>
  </section>`;
  }).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-project-integration-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="project-integration" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');

  return `<!DOCTYPE html>
<html><head><style>
${kronosWebviewBaseCss()}
.integration-shell { max-width: 1320px; }
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
.project-identity, .project-path { margin-top: 3px; color: var(--k-muted); font-size: 11px; word-break: break-all; }
.field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.form-field label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 650; }
.form-field input { width: 100%; }
.form-field textarea { width: 100%; min-height: 112px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
.form-field.wide { grid-column: 1 / -1; }
.field-help { margin-top: 4px; color: var(--k-muted); font-size: 10px; line-height: 1.35; }
.jenkins-url-guide { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 10px; align-items: baseline; margin-top: 7px; padding: 9px 10px; border-left: 3px solid var(--k-info); background: var(--k-surface-soft); font-size: 10px; line-height: 1.4; }
.jenkins-url-guide strong { color: var(--k-fg); }
.jenkins-url-guide code { overflow-wrap: anywhere; color: var(--k-fg); }
.jenkins-url-guide span { grid-column: 1 / -1; color: var(--k-muted); }
.branch-routing { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--k-border); }
.branch-routing > summary { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; cursor: pointer; font-size: 12px; font-weight: 650; }
.branch-routing > summary::marker { color: var(--k-muted); }
.branch-routing > summary span { color: var(--k-muted); font-size: 11px; font-weight: 400; text-align: right; }
.branch-routing-grid { display: grid; grid-template-columns: minmax(220px, .7fr) minmax(0, 1.3fr); gap: 12px; align-items: start; padding-top: 12px; }
.integration-actions { position: sticky; bottom: 0; z-index: 2; margin-top: 16px; padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: color-mix(in srgb, var(--k-bg) 92%, transparent); backdrop-filter: blur(8px); }
.privacy-copy { margin-left: auto; color: var(--k-muted); font-size: 11px; }
@media (max-width: 1100px) { .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .readiness-grid, .field-grid, .branch-routing-grid { grid-template-columns: 1fr; } .branch-routing > summary { align-items: flex-start; flex-direction: column; gap: 3px; } .branch-routing > summary span { text-align: left; } .privacy-copy { width: 100%; margin-left: 0; } }
</style></head>
<body><main class="kronos-shell integration-shell">
  <header class="kronos-header integration-header">
    <div>
      <h1 class="kronos-title">Project integrations</h1>
      <div class="kronos-subtitle">Connect each local project to its read-only GitLab, Jenkins, and SonarQube sources.</div>
    </div>
    <span class="kronos-pill info">Local settings</span>
  </header>
  <section class="readiness-grid">${readiness}</section>
  <div class="message warn">Credentials remain in the private Kronos environment file. Saving here only changes local read targets and branch routing; it never switches branches, runs tests, changes code, or posts to a provider.</div>
  <section class="integration-list">${projectCards || '<div class="kronos-empty">No registered local projects are available to configure.</div>'}</section>
  <div class="kronos-action-row integration-actions">
    <button type="button" class="kronos-button primary" data-action="save">Save changes</button>
    <button type="button" class="kronos-button" data-action="cancel">Cancel</button>
    <span class="privacy-copy">Leaving a field blank removes that optional setting. Ctrl+Enter saves.</span>
  </div>
</main>
${script}
</body></html>`;
}

function formField(
  label: string,
  field: string,
  value: string,
  placeholder: string,
  help: string,
  wide = false,
  maxLength?: number,
): string {
  return `<div class="form-field${wide ? ' wide' : ''}">
    <label>${escapeHtml(label)}
      <input class="kronos-input" type="text" data-field="${escapeAttr(field)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}"${maxLength ? ` maxlength="${maxLength}"` : ''} autocomplete="off" spellcheck="false">
    </label>
    <div class="field-help">${escapeHtml(help)}</div>
  </div>`;
}

function jenkinsJobUrlField(value: string): string {
  return `<div class="form-field wide">
    <label>${escapeHtml('Jenkins job URL (or multibranch parent)')}
      <input class="kronos-input" type="text" data-field="jenkinsUrl" value="${escapeAttr(value)}" placeholder="https://jenkins.example/job/team/job/service/" autocomplete="off" spellcheck="false">
    </label>
    <div class="field-help">Kronos polls this reusable job target for the latest build, stages, tests, and optional SonarQube configuration.</div>
    <div class="jenkins-url-guide">
      <strong>Expected /job/ path</strong>
      <code>https://jenkins.example/job/team/job/service/</code>
      <span>Nested folders repeat /job/. For a multibranch pipeline, enter its parent job URL here; Default monitoring branch or Branch routing selects the branch. Do not enter only the Jenkins server, and do not use /branch/, /view/, /console, /api/json, or a numbered build URL.</span>
    </div>
  </div>`;
}

function formTextarea(label: string, field: string, value: string, placeholder: string, help: string, wide = true): string {
  return `<div class="form-field${wide ? ' wide' : ''}">
    <label>${escapeHtml(label)}
      <textarea class="kronos-input" data-field="${escapeAttr(field)}" maxlength="20000" placeholder="${escapeAttr(placeholder)}" spellcheck="false">${escapeHtml(value)}</textarea>
    </label>
    <div class="field-help">${escapeHtml(help)}</div>
  </div>`;
}
