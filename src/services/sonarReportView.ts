import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewVsCodeApiScript } from './webviewSecurity';

interface SonarReportRenderInput {
  projectName: string;
  branch: string;
  sonarKey: string;
  host?: string;
  gate: unknown;
  measures: unknown;
  issues: unknown;
  nonce: string;
}

interface SonarReportRenderResult {
  html: string;
  dashboardUrl?: string;
  issueList: SonarIssue[];
}

interface SonarCondition {
  status?: string;
  metricKey?: string;
  comparator?: string;
  errorThreshold?: unknown;
  actualValue?: unknown;
}

interface SonarMeasure {
  metric?: string;
  value?: unknown;
  period?: {
    value?: unknown;
  };
}

export interface SonarIssue {
  severity?: string;
  rule?: string;
  component?: string;
  line?: unknown;
  message?: string;
}

function buildSonarDashboardUrl(host: string | undefined, sonarKey: string, branch: string): string | undefined {
  if (!host) { return undefined; }
  try {
    const base = new URL(host);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      return undefined;
    }
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
    base.search = '';
    base.hash = '';
    const url = new URL('dashboard', base);
    url.searchParams.set('id', sonarKey);
    url.searchParams.set('branch', branch);
    return url.toString();
  } catch {
    return undefined;
  }
}

function formatSonarMetricName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\bnew\b/g, 'New').replace(/\b\w/g, c => c.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function projectStatusRecord(gate: unknown): Record<string, unknown> {
  if (isRecord(gate) && isRecord(gate['projectStatus'])) {
    return gate['projectStatus'];
  }
  return {};
}

function sonarGateStatus(gate: unknown): string {
  const projectStatus = projectStatusRecord(gate);
  if (typeof projectStatus['status'] === 'string' && projectStatus['status'].trim()) {
    return projectStatus['status'];
  }
  if (isRecord(gate) && typeof gate['status'] === 'string' && gate['status'].trim()) {
    return gate['status'];
  }
  return 'UNKNOWN';
}

function sonarConditionList(gate: unknown): SonarCondition[] {
  const projectStatus = projectStatusRecord(gate);
  if (!Array.isArray(projectStatus['conditions'])) { return []; }
  return projectStatus['conditions'].filter(isRecord).map(condition => {
    const normalized: SonarCondition = {
      errorThreshold: condition['errorThreshold'],
      actualValue: condition['actualValue'],
    };
    if (typeof condition['status'] === 'string') { normalized.status = condition['status']; }
    if (typeof condition['metricKey'] === 'string') { normalized.metricKey = condition['metricKey']; }
    if (typeof condition['comparator'] === 'string') { normalized.comparator = condition['comparator']; }
    return normalized;
  });
}

function sonarMeasureList(measures: unknown): SonarMeasure[] {
  if (!isRecord(measures)) { return []; }
  const component = isRecord(measures['component']) ? measures['component'] : undefined;
  const componentMeasures = component && Array.isArray(component['measures'])
    ? component['measures']
    : undefined;
  const list = componentMeasures || (Array.isArray(measures['measures']) ? measures['measures'] : []);
  return list.filter(isRecord).map(measure => {
    const normalized: SonarMeasure = { value: measure['value'] };
    if (typeof measure['metric'] === 'string') { normalized.metric = measure['metric']; }
    if (isRecord(measure['period'])) { normalized.period = { value: measure['period']['value'] }; }
    return normalized;
  });
}

function sonarIssueList(issues: unknown): SonarIssue[] {
  if (!isRecord(issues) || !Array.isArray(issues['issues'])) { return []; }
  return issues['issues'].filter(isRecord).map(issue => {
    const normalized: SonarIssue = { line: issue['line'] };
    if (typeof issue['severity'] === 'string') { normalized.severity = issue['severity']; }
    if (typeof issue['rule'] === 'string') { normalized.rule = issue['rule']; }
    if (typeof issue['component'] === 'string') { normalized.component = issue['component']; }
    if (typeof issue['message'] === 'string') { normalized.message = issue['message']; }
    return normalized;
  });
}

export function buildSonarReport(input: SonarReportRenderInput): SonarReportRenderResult {
  const gateStatus = sonarGateStatus(input.gate);
  const gateIcon = gateStatus === 'OK' ? '&#x2705;' : gateStatus === 'ERROR' ? '&#x274C;' : '&#x26A0;';
  const gateClass = gateStatus === 'OK' ? 'pass' : gateStatus === 'ERROR' ? 'fail' : 'warn';

  const conditions = sonarConditionList(input.gate).slice().sort((a, b) => {
    if (a.status === 'ERROR' && b.status !== 'ERROR') { return -1; }
    if (a.status !== 'ERROR' && b.status === 'ERROR') { return 1; }
    return 0;
  });
  const gateCondRows = conditions.map(c => {
    const icon = c.status === 'OK' ? '&#x2705;' : '&#x274C;';
    const rowClass = c.status === 'ERROR' ? ' class="fail"' : '';
    const label = formatSonarMetricName(String(c.metricKey || ''));
    const op = c.comparator === 'GT' ? '>' : c.comparator === 'LT' ? '<' : String(c.comparator || '');
    return `<tr${rowClass}><td>${icon}</td><td>${escapeHtml(label)}</td><td>${escapeHtml(op)} ${escapeHtml(String(c.errorThreshold ?? ''))}</td><td>${escapeHtml(String(c.actualValue ?? ''))}</td></tr>`;
  }).join('');

  const measureList = sonarMeasureList(input.measures);
  const metricsHtml = measureList.map(m => {
    const metricKey = String(m.metric || '');
    const label = formatSonarMetricName(metricKey);
    const val = m.value ?? m.period?.value ?? '-';
    const suffix = metricKey.includes('coverage') || metricKey.includes('duplicat') ? '%' : '';
    return `<div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(String(val))}${suffix}</div><div class="kronos-stat-label">${escapeHtml(label)}</div></div>`;
  }).join('');

  const issueList = sonarIssueList(input.issues);
  const issueRows = issueList.slice(0, 50).map(iss => {
    const file = String(iss.component || '').replace(/^[^:]+:/, '');
    const sevClass = escapeClass(String(iss.severity || '').toLowerCase());
    const rule = String(iss.rule || '').replace(/^[^:]+:/, '');
    const line = iss.line ? `:${escapeHtml(String(iss.line))}` : '';
    return `<tr class="sev-${sevClass}"><td><span class="kronos-pill ${sevClass}">${escapeHtml(String(iss.severity || '-'))}</span></td><td><code>${escapeHtml(rule)}</code></td><td>${escapeHtml(file)}${line}</td><td class="kronos-detail">${escapeHtml(String(iss.message || ''))}</td></tr>`;
  }).join('');

  const dashboardUrl = buildSonarDashboardUrl(input.host, input.sonarKey, input.branch);
  const openSonarScript = dashboardUrl
    ? `const openSonar = document.getElementById('open-sonar');
            openSonar.addEventListener('click', function() {
              kronosVsCodeApi().postMessage({ command: 'openSonar' });
            });`
    : '';
  const html = `<!DOCTYPE html><html><head>
        <style>
          ${kronosWebviewBaseCss()}
          .sonar-shell { max-width: 1200px; }
          .gate-banner {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 12px 0 20px;
            padding: 14px 16px;
            border: 1px solid var(--k-border);
            border-left: 3px solid var(--k-border);
            border-radius: var(--k-radius);
            background: var(--k-surface-soft);
            font-size: 16px;
            font-weight: 650;
          }
          .gate-banner.pass { border-left-color: var(--k-ok); }
          .gate-banner.warn { border-left-color: var(--k-warn); }
          .gate-banner.fail { border-left-color: var(--k-danger); }
          tr.fail td { background: rgba(244,67,54,0.08); }
          .actions { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 10px; }
        </style></head><body><div class="kronos-shell sonar-shell">
          <div class="kronos-header">
            <div>
              <h1 class="kronos-title">SonarQube Report: ${escapeHtml(input.projectName)}</h1>
              <div class="kronos-subtitle">Branch ${escapeHtml(input.branch)}. Quality gate, measures, and the first 50 open issues.</div>
            </div>
          </div>
          <div class="gate-banner ${gateClass}">${gateIcon} Quality Gate: ${escapeHtml(gateStatus)}</div>

          ${conditions.length ? `<div class="kronos-section"><h2 class="kronos-section-title">Gate Conditions</h2>
          <div class="kronos-table-wrap kronos-panel"><table class="kronos-table"><tr><th></th><th>Condition</th><th>Threshold</th><th>Actual</th></tr>${gateCondRows}</table></div></div>` : ''}

          <div class="kronos-section"><h2 class="kronos-section-title">Metrics</h2>
          <div class="kronos-stat-grid">${metricsHtml || '<div class="kronos-empty">No metrics available.</div>'}</div></div>

          <div class="kronos-section"><h2 class="kronos-section-title">Issues (${issueList.length}${issueList.length > 50 ? ' &mdash; showing first 50' : ''})</h2>
          ${issueRows ? `<div class="kronos-table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Rule</th><th>File</th><th>Message</th></tr>${issueRows}</table></div>` : '<div class="kronos-empty">No open issues.</div>'}</div>

          <div class="actions">
            <button class="kronos-button primary" id="fix-sonar" type="button">Fix Issues</button>
            ${dashboardUrl ? '<button class="kronos-button" id="open-sonar" type="button">Open in SonarQube</button>' : ''}
          </div>
          <script nonce="${escapeAttr(input.nonce)}">
            ${webviewVsCodeApiScript()}
            document.getElementById('fix-sonar').addEventListener('click', function() {
              kronosVsCodeApi().postMessage({ command: 'fixSonar' });
            });
            ${openSonarScript}
          </script>
        </div></body></html>`;

  const result: SonarReportRenderResult = { html, issueList };
  if (dashboardUrl) { result.dashboardUrl = dashboardUrl; }
  return result;
}
