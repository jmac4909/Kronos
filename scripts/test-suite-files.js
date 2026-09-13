const TEST_RUNNER_PATTERN = /^node (scripts\/run-[a-z0-9-]+-tests\.js)$/;
const NPM_SCRIPT_PATTERN = /^npm run ([a-z0-9:-]+)$/;

/** Derives the ordered test-runner inventory from the actual npm test graph. */
function testSuiteFiles(manifest) {
  const files = [];
  const seenFiles = new Set();
  const visitedScripts = new Set();

  const visit = scriptName => {
    if (visitedScripts.has(scriptName)) { return; }
    visitedScripts.add(scriptName);
    const command = manifest?.scripts?.[scriptName];
    if (typeof command !== 'string') { return; }
    for (const rawSegment of command.split('&&')) {
      const segment = rawSegment.trim();
      const runner = TEST_RUNNER_PATTERN.exec(segment)?.[1];
      if (runner && !seenFiles.has(runner)) {
        seenFiles.add(runner);
        files.push(runner);
        continue;
      }
      const nestedScript = NPM_SCRIPT_PATTERN.exec(segment)?.[1];
      if (nestedScript) { visit(nestedScript); }
    }
  };

  visit('test');
  return files;
}

module.exports = { testSuiteFiles };
