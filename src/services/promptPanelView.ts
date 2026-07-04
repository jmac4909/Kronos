import { PromptHistoryDiff, PromptHistorySnapshot, PromptSmokeResult, PromptTemplateInfo } from './promptManager';
import { actionButton, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeClass, escapeHtml } from './webviewHtml';

export interface ProjectPromptOverride {
  project: string;
  template: PromptTemplateInfo;
}

export function buildPromptManagerHtml(
  globalTemplates: PromptTemplateInfo[],
  projectOverrides: ProjectPromptOverride[],
  smokeResults: PromptSmokeResult[],
  requiredPrompts: string[],
  nonce?: string,
  actionScriptUri?: string,
): string {
  const globalByName = new Map(globalTemplates.map(t => [t.name, t]));
  const missing = requiredPrompts.filter(name => !globalByName.has(name));
  const requiredRows = requiredPrompts.map(name => {
    const template = globalByName.get(name);
    const status = template ? 'pass' : 'fail';
    const detail = template
      ? `${template.hash.substring(0, 12)} - ${template.variables.length} variable(s)`
      : 'missing';
    return `<tr><td><span class="pill ${status}">${status}</span></td><td>${escapeHtml(name)}</td><td>${escapeHtml(detail)}</td></tr>`;
  }).join('');

  const templateRows = globalTemplates.map(promptTemplateRow).join('');
  const smokeRows = smokeResults.map(promptSmokeResultRow).join('');
  const smokeSummary = {
    pass: smokeResults.filter(result => result.status === 'pass').length,
    fail: smokeResults.filter(result => result.status === 'fail').length,
  };
  const overrideRows = projectOverrides.map(({ project, template }) => `
    <tr>
      <td>${escapeHtml(project)}</td>
      <td>${escapeHtml(template.name)}</td>
      <td><code>${escapeHtml(template.hash.substring(0, 12))}</code></td>
      <td>${escapeHtml(template.modifiedAt)}</td>
      <td>${escapeHtml(template.variables.join(', ') || '-')}</td>
      <td>${escapeHtml(template.path)}</td>
    </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('promptSmokeTests', 'Smoke Tests'),
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptHistory', 'History'),
    actionButton('repairPromptPack', 'Repair'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt Manager</h1>
      <div class="kronos-subtitle">Required prompts, smoke coverage, global templates, and project overrides</div>
    </div>
  </div>
  ${actions}
  <div class="operator-section"><h2>Required Prompt Pack</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Prompt</th><th>Detail</th></tr>${requiredRows}</table></div>
  ${missing.length > 0 ? `<div class="kronos-empty">Missing required prompts: ${escapeHtml(missing.join(', '))}</div>` : ''}</div>

  <div class="operator-section"><h2>Prompt Smoke Tests</h2>
  <div class="subtitle">${smokeSummary.pass} passing, ${smokeSummary.fail} failing.</div>
  ${smokeResults.length === 0 ? '<div class="kronos-empty">No prompt smoke tests configured.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Test</th><th>Template</th><th>Detail</th></tr>${smokeRows}</table></div>`}</div>

  <div class="operator-section"><h2>Global Templates</h2>
  ${globalTemplates.length === 0 ? '<div class="kronos-empty">No global prompt templates found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Name</th><th>Hash</th><th>Modified</th><th>Variables</th><th>Path</th></tr>${templateRows}</table></div>`}</div>

  <div class="operator-section"><h2>Project Overrides</h2>
  ${projectOverrides.length === 0 ? '<div class="kronos-empty">No project prompt overrides found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Project</th><th>Name</th><th>Hash</th><th>Modified</th><th>Variables</th><th>Path</th></tr>${overrideRows}</table></div>`}</div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Prompt Manager', true, actionScriptUri) : ''}</body></html>`;
}

export function buildPromptHistoryHtml(snapshots: PromptHistorySnapshot[], diff?: PromptHistoryDiff, nonce?: string, actionScriptUri?: string): string {
  const snapshotRows = snapshots.map(snapshot => `<tr>
    <td>${escapeHtml(snapshot.createdAt)}</td>
    <td>${escapeHtml(snapshot.scope)}</td>
    <td>${escapeHtml(String(snapshot.templateCount))}</td>
    <td><code>${escapeHtml(snapshot.id)}</code></td>
  </tr>`).join('');
  const diffRows = (diff?.changes || []).map(change => {
    const hash = `${change.beforeHash ? change.beforeHash.substring(0, 12) : '-'} -> ${change.afterHash ? change.afterHash.substring(0, 12) : '-'}`;
    const variables = `${(change.beforeVariables || []).join(', ') || '-'} -> ${(change.afterVariables || []).join(', ') || '-'}`;
    return `<tr>
      <td><span class="pill ${escapeClass(change.kind)}">${escapeHtml(change.kind)}</span></td>
      <td>${escapeHtml(change.name)}<br><span class="muted">${escapeHtml(change.source)}</span></td>
      <td><code>${escapeHtml(hash)}</code></td>
      <td>${escapeHtml(variables)}</td>
      <td>${escapeHtml(change.path)}</td>
    </tr>`;
  }).join('');
  const diffSummary = diff
    ? `${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed, ${diff.summary.unchanged} unchanged.`
    : 'No prompt history snapshots yet.';
  const actions = operatorCommandRow([
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptManager', 'Prompt Manager'),
    actionButton('promptSmokeTests', 'Smoke Tests'),
    actionButton('repairPromptPack', 'Repair'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .pill.added { color: #4caf50; background: rgba(76,175,80,0.16); }
  .pill.removed { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.changed { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.unchanged { color: var(--k-muted); background: rgba(128,128,128,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt History</h1>
      <div class="kronos-subtitle">${escapeHtml(diffSummary)}</div>
    </div>
  </div>
  ${actions}
  <div class="operator-section"><h2>Latest Diff</h2>
  ${diff ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Prompt</th><th>Hash</th><th>Variables</th><th>Path</th></tr>${diffRows}</table></div>` : '<div class="kronos-empty">Create a prompt snapshot to start history tracking.</div>'}</div>
  <div class="operator-section"><h2>Snapshots</h2>
  ${snapshots.length === 0 ? '<div class="kronos-empty">No prompt snapshots found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Created</th><th>Scope</th><th>Templates</th><th>ID</th></tr>${snapshotRows}</table></div>`}</div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Prompt History', true, actionScriptUri) : ''}</body></html>`;
}

export function buildPromptSmokeTestsHtml(results: PromptSmokeResult[], nonce?: string, actionScriptUri?: string): string {
  const pass = results.filter(result => result.status === 'pass').length;
  const fail = results.filter(result => result.status === 'fail').length;
  const rows = results.map(promptSmokeResultRow).join('');
  const actions = operatorCommandRow([
    actionButton('promptManager', 'Prompt Manager'),
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptHistory', 'History'),
    actionButton('repairPromptPack', 'Repair'),
  ]);
  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt Smoke Tests</h1>
      <div class="kronos-subtitle">${pass} passing, ${fail} failing.</div>
    </div>
  </div>
  ${actions}
  ${results.length === 0 ? '<div class="kronos-empty">No prompt smoke tests configured.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Test</th><th>Template</th><th>Detail</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Prompt Smoke Tests', true, actionScriptUri) : ''}</body></html>`;
}

function promptSmokeResultRow(result: PromptSmokeResult): string {
  const detail = result.errors.length > 0
    ? result.errors.join('; ')
    : `${result.renderedBytes || 0} bytes rendered${result.renderedHash ? `, hash ${result.renderedHash.substring(0, 12)}` : ''}`;
  return `<tr>
    <td><span class="pill ${escapeClass(result.status)}">${escapeHtml(result.status)}</span></td>
    <td>${escapeHtml(result.id)}${result.source ? `<br><span class="muted">${escapeHtml(result.source)}</span>` : ''}</td>
    <td>${escapeHtml(result.templateName)}</td>
    <td>${escapeHtml(detail)}</td>
  </tr>`;
}

function promptTemplateRow(template: PromptTemplateInfo): string {
  return `<tr>
    <td>${escapeHtml(template.name)}</td>
    <td><code>${escapeHtml(template.hash.substring(0, 12))}</code></td>
    <td>${escapeHtml(template.modifiedAt)}</td>
    <td>${escapeHtml(template.variables.join(', ') || '-')}</td>
    <td>${escapeHtml(template.path)}</td>
  </tr>`;
}
