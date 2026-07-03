const fs = require('fs');

const extension = fs.readFileSync('src/extension.ts', 'utf8');
const dispatcher = fs.readFileSync('src/runners/sessionDispatcher.ts', 'utf8');
const manager = fs.readFileSync('src/services/promptManager.ts', 'utf8');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const marker of [
  'kronos.promptManager',
  'function loadPromptForDispatch',
  'listPromptTemplates',
  'const REQUIRED_PROMPTS',
]) {
  if (!extension.includes(marker)) {
    fail(`Missing prompt governance marker in extension.ts: ${marker}`);
  }
}

for (const marker of [
  'export interface PromptRunMetadata',
  'promptMetadata?: PromptRunMetadata',
  'appendSystemPromptHash',
]) {
  if (!dispatcher.includes(marker)) {
    fail(`Missing prompt run metadata marker in sessionDispatcher.ts: ${marker}`);
  }
}

for (const marker of [
  'export function renderPrompt',
  'export function listPromptTemplates',
  'repairRequiredPromptTemplates',
  'missingVariables',
  'templateHash',
  'renderedHash',
]) {
  if (!manager.includes(marker)) {
    fail(`Missing prompt manager marker: ${marker}`);
  }
}

const directLoadPromptCalls = [...extension.matchAll(/state\.loadPrompt\(/g)].length;
if (directLoadPromptCalls !== 1 || !extension.includes("return state.loadPrompt('implement-system');")) {
  fail('Template dispatches must use loadPromptForDispatch; only getImplementPrompt may call state.loadPrompt directly.');
}

const customPromptLines = extension.split('\n').filter(line => line.includes('customPrompt:'));
const metadataDispatches = extension.split('\n').filter(line => /^\s+promptMetadata:/.test(line)).length;
if (metadataDispatches < 10) {
  fail(`Expected prompt metadata on template dispatches, found ${metadataDispatches}.`);
}
if (customPromptLines.length < metadataDispatches) {
  fail('Prompt metadata count exceeds custom prompt count; static check needs review.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Prompt governance OK.');
