import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { kronosActionPanelScript } from './operatorPanel';
import { isRecord, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records';

interface SonarReportRenderInput {
  projectName: string;
  branch: string;
  sonarKey: string;
  host?: string;
  gate: unknown;
  measures: unknown;
  issues: unknown;
  nonce: string;
  actionScriptUri: string;
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

function projectStatusRecord(gate: unknown): Record<string, unknown> {
  if (isRecord(gate) && isRecord(gate['projectStatus'])) {
    return gate['projectStatus'];
  }
  return {};
}

function sonarGateStatus(gate: unknown): string {
  const projectStatus = projectStatusRecord(gate);
  return optionalTrimmedStringFromUnknown(projectStatus['status'])
    || (isRecord(gate) ? optionalTrimmedStringFromUnknown(gate['status']) : undefined)
    || 'UNKNOWN';
}

function sonarConditionList(gate: unknown): SonarCondition[] {
  const projectStatus = projectStatusRecord(gate);
  return recordsFromUnknown(projectStatus['conditions']).map(condition => {
    const normalized: SonarCondition = {
      errorThreshold: condition['errorThreshold'],
      actualValue: condition['actualValue'],
    };
    const status = optionalTrimmedStringFromUnknown(condition['status']);
    const metricKey = optionalTrimmedStringFromUnknown(condition['metricKey']);
    const comparator = optionalTrimmedStringFromUnknown(condition['comparator']);
    if (status) { normalized.status = status; }
    if (metricKey) { normalized.metricKey = metricKey; }
    if (comparator) { normalized.comparator = comparator; }
    return normalized;
  });
}

function sonarMeasureList(measures: unknown): SonarMeasure[] {
  if (!isRecord(measures)) { return []; }
  const component = isRecord(measures['component']) ? measures['component'] : undefined;
  const componentMeasures = component ? recordsFromUnknown(component['measures']) : [];
  const list = componentMeasures.length > 0 ? componentMeasures : recordsFromUnknown(measures['measures']);
  return list.map(measure => {
    const normalized: SonarMeasure = { value: measure['value'] };
    const metric = optionalTrimmedStringFromUnknown(measure['metric']);
    if (metric) { normalized.metric = metric; }
    if (isRecord(measure['period'])) { normalized.period = { value: measure['period']['value'] }; }
    return normalized;
  });
}

function sonarIssueList(issues: unknown): SonarIssue[] {
  if (!isRecord(issues)) { return []; }
  return recordsFromUnknown(issues['issues']).map(issue => {
    const normalized: SonarIssue = { line: issue['line'] };
    const severity = optionalTrimmedStringFromUnknown(issue['severity']);
    const rule = optionalTrimmedStringFromUnknown(issue['rule']);
    const component = optionalTrimmedStringFromUnknown(issue['component']);
    const message = optionalTrimmedStringFromUnknown(issue['message']);
    if (severity) { normalized.severity = severity; }
    if (rule) { normalized.rule = rule; }
    if (component) { normalized.component = component; }
    if (message) { normalized.message = message; }
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
            <button class="kronos-button primary" id="fix-sonar" type="button" data-action="fixSonar">Fix Issues</button>
            ${dashboardUrl ? '<button class="kronos-button" id="open-sonar" type="button" data-action="openSonar">Open in SonarQube</button>' : ''}
          </div>
          ${kronosActionPanelScript(input.nonce, 'Kronos Sonar Report', input.actionScriptUri)}
        </div></body></html>`;

  const result: SonarReportRenderResult = { html, issueList };
  if (dashboardUrl) { result.dashboardUrl = dashboardUrl; }
  return result;
}
