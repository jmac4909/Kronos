import { AgingReport } from './agingAnalyzer';
import { escapeClass, escapeHtml, kronosWebviewBaseCss, safeHttpHref } from './webviewHtml';

interface AgingReportHtmlOptions {
  actionsHtml?: string;
  scriptHtml?: string;
}

export function buildAgingReportHtml(report: AgingReport, options: AgingReportHtmlOptions = {}): string {
  const generated = formatDateTime(report.generatedAt);
  const rows = report.items.map(item => {
    const href = safeHttpHref(item.url);
    const severity = escapeClass(item.severity);
    const ref = href ? `<a href="${href}">${escapeHtml(item.url || '')}</a>` : '-';
    return `<tr>
      <td><span class="kronos-pill ${severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
      <td>${escapeHtml(item.ticketKey)}</td>
      <td>${escapeHtml(item.kind)}</td>
      <td>${escapeHtml(String(item.ageDays))}d / ${escapeHtml(String(item.thresholdDays))}d</td>
      <td><strong>${escapeHtml(item.title)}</strong><div class="kronos-detail">${escapeHtml(item.detail)}</div></td>
      <td class="ref">${ref}</td>
    </tr>`;
  }).join('');
  const empty = report.items.length === 0 ? '<div class="kronos-empty">No stale Kronos items found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .aging-shell { max-width: 1280px; }
  .ref { word-break: break-all; }
  .ref a { color: var(--k-accent); text-decoration: none; }
  .ref a:hover { text-decoration: underline; }
</style></head><body><div class="kronos-shell aging-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Aging Report</h1>
      <div class="kronos-subtitle">Generated ${escapeHtml(generated)}. Stale reviews, builds, blockers, verification, and tickets.</div>
    </div>
  </div>
  ${options.actionsHtml || ''}
  <div class="kronos-stat-grid">
    <div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(String(report.summary.critical))}</div><div class="kronos-stat-label">Critical</div></div>
    <div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(String(report.summary.warning))}</div><div class="kronos-stat-label">Warnings</div></div>
    <div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(String(report.summary.info))}</div><div class="kronos-stat-label">Info</div></div>
    <div class="kronos-stat"><div class="kronos-stat-value">${escapeHtml(String(report.summary.total))}</div><div class="kronos-stat-label">Total</div></div>
  </div>
  ${empty || `<div class="kronos-table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Ticket</th><th>Kind</th><th>Age</th><th>Issue</th><th>Ref</th></tr>${rows}</table></div>`}
</div>${options.scriptHtml || ''}</body></html>`;
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') { return 'N/A'; }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}
