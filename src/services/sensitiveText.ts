/** Redacts credential-shaped text shared by every persisted provider evidence path. */
export function redactSensitiveTokens(value: string): string {
  return value
    .replace(/-----BEGIN [^\-\r\n]*(?:PRIVATE KEY|SECRET)[^\-\r\n]*-----[\s\S]*?-----END [^\-\r\n]*(?:PRIVATE KEY|SECRET)[^\-\r\n]*-----/gi, '[REDACTED PRIVATE MATERIAL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi, '[REDACTED AUTHORIZATION]')
    .replace(/\b(?:glpat-|sqp_|ATATT|github_pat_|gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED PROVIDER TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS ACCESS KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED JWT]')
    .replace(/([?&](?:token|access[_-]?token|api[_-]?key|private[_-]?token|password|secret|credential)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|token|private[-_ ]?token|access[-_ ]?token|api[-_ ]?key|client[-_ ]?secret|password|passwd|secret|credential)\s*[:=]\s*)(?!\[REDACTED(?:\s|\]))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(["']?[A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/g, '$1[REDACTED]')
    .replace(/(^\s*[+\- ]?\s*(?:export\s+)?(?:(?:const|let|var|readonly|final|def|string)\s+)?[A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_.-]*\s*[:=]\s*).+$/gim, '$1[REDACTED]');
}
