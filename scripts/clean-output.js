const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out');

if (path.dirname(output) !== root || path.basename(output) !== 'out') {
  throw new Error('Refusing to clean an unexpected output path.');
}

fs.rmSync(output, { recursive: true, force: true });
