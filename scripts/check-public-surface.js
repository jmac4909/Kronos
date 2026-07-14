'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const self = 'scripts/check-public-surface.js';
const maxTextBytes = 2 * 1024 * 1024;
const knownEmployerPattern = new RegExp([
  '\\b\\x62\\x63\\x62\\x73\\x6d\\x61\\b',
  '\\b\\x62\\x6c\\x75\\x65\\s+\\x63\\x72\\x6f\\x73\\x73\\s+\\x62\\x6c\\x75\\x65\\s+\\x73\\x68\\x69\\x65\\x6c\\x64\\s+\\x6f\\x66\\s+\\x6d\\x61\\x73\\x73\\x61\\x63\\x68\\x75\\x73\\x65\\x74\\x74\\x73\\b',
].join('|'), 'i');

const forbiddenPaths = [
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.kronos(\/|$)/,
  /(^|\/)\.vscode-test(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
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
    label: 'employer-specific identifier',
    pattern: knownEmployerPattern,
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
  if (forbiddenPaths.some(pattern => pattern.test(relativePath))) {
    failures.push(`${relativePath}: local/generated/sensitive path must not be tracked`);
    continue;
  }

  if (relativePath === self) {
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

console.log(`Kronos public surface OK (${tracked.length} public files; no local-state paths, machine paths, employer identifiers, or high-confidence secret shapes).`);
