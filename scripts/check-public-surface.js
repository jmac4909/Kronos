'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const self = 'scripts/check-public-surface.js';
const maxTextBytes = 2 * 1024 * 1024;
const privateMarkers = [...new Set(String(process.env.KRONOS_PUBLICATION_DENY_TERMS || '')
  .split('|').map(value => value.trim().toLowerCase()).filter(Boolean))];
if (privateMarkers.some(value => value.length < 3)) {
  console.error('Publication deny terms must each contain at least 3 characters.');
  process.exit(2);
}

function containsPrivateMarker(value) {
  const text = String(value).toLowerCase();
  const decoded = text.replace(/\\+x([0-9a-f]{2})|\\+u([0-9a-f]{4})/g,
    (_, hex, unicode) => String.fromCharCode(parseInt(hex || unicode, 16)));
  return privateMarkers.some(marker => text.includes(marker) || decoded.includes(marker));
}

const forbiddenPaths = [
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.kronos(\/|$)/,
  /(^|\/)\.vscode-test(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:push-master|cache-github-token)\.sh$/,
  /\.(?:vsix|zip|tgz|log)$/i,
];

const contentRules = [
  {
    label: 'machine-specific Linux home path',
    pattern: /\/home\/(?!USER(?:\/|\b)|example(?:\/|\b)|user(?:\/|\b))[A-Za-z0-9._-]+/i,
  },
  {
    label: 'machine-specific macOS home path',
    pattern: /\/Users\/(?!USER(?:\/|\b)|example(?:\/|\b)|user(?:\/|\b))[A-Za-z0-9._-]+/i,
  },
  {
    label: 'machine-specific Windows user path',
    pattern: /[A-Za-z]:\\Users\\(?!USER(?:\\|\b)|example(?:\\|\b)|user(?:\\|\b))[A-Za-z0-9._-]+/i,
  },
  {
    label: 'public EC2 instance hostname',
    pattern: /ec2-(?:\d{1,3}-){3}\d{1,3}\.[a-z0-9.-]*compute\.amazonaws\.com/i,
  },
  {
    label: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  {
    label: 'AWS access-key-shaped value',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    label: 'GitHub token-shaped value',
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    label: 'GitLab token-shaped value',
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  },
];

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const failures = [];

for (const relativePath of tracked) {
  if (containsPrivateMarker(relativePath)) {
    failures.push('[redacted path]: private publication marker');
    continue;
  }
  if (forbiddenPaths.some(pattern => pattern.test(relativePath))) {
    failures.push(`${relativePath}: local/generated/sensitive path must not be tracked`);
    continue;
  }

  const absolutePath = path.join(root, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    failures.push(`${relativePath}: symbolic links are not allowed on the public surface`);
    continue;
  }
  if (!stat.isFile() || stat.size > maxTextBytes) {
    continue;
  }

  const content = fs.readFileSync(absolutePath);
  if (content.includes(0)) {
    continue;
  }
  const text = content.toString('utf8');
  if (containsPrivateMarker(text)) {
    failures.push(`${relativePath}: private publication marker`);
  }
  if (relativePath === self) {
    continue;
  }
  for (const rule of contentRules) {
    if (rule.pattern.test(text)) {
      failures.push(`${relativePath}: ${rule.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Kronos public-surface check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Kronos public surface OK (${tracked.length} public files checked for local-state paths, machine paths, configured private markers and high-confidence secret shapes).`);
