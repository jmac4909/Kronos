import * as fs from 'fs';

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, 'utf-8')));
}

function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}
