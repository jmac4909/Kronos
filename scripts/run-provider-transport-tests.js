const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const test = require('node:test');

const {
  JiraRestCancelledError,
  JiraRestClient,
} = require('../out/services/jiraRestClient.js');
const { GitLabRestClient } = require('../out/services/gitlabRestClient.js');
const { JenkinsRestClient } = require('../out/services/jenkinsRestClient.js');
const { SonarRestClient } = require('../out/services/sonarRestClient.js');
const { boundedHttpTransport } = require('../out/services/boundedHttpTransport.js');

const genericPolicy = {
  allowHttp: 'loopback',
  invalidUrl: 'invalid URL',
  invalidProtocol: 'invalid protocol',
  responseLimit: max => `limit ${max}`,
  unexpectedResponse: 'unexpected response',
  timeout: timeoutMs => `timeout ${timeoutMs}`,
  network: 'network failure',
  createError: (message, kind) => new Error(`${kind}: ${message}`),
};

test('shared bounded transport rejects invalid authority and preserves text, buffer, response-error, and network outcomes', async () => {
  const request = (url, overrides = {}, policy = genericPolicy) => boundedHttpTransport({
    method: 'GET', url, headers: {}, timeoutMs: 250, maxResponseBytes: 1024, ...overrides,
  }, policy);
  await assert.rejects(request('not a URL'), /other: invalid URL/);
  await assert.rejects(request('ftp://example.test/file'), /other: invalid protocol/);
  await assert.rejects(request('http://example.test/file'), /other: invalid protocol/);

  await withServer((_incoming, response) => {
    response.writeHead(201, { 'content-type': 'text/plain' });
    response.end('hello');
  }, async baseUrl => {
    const textResponse = await request(baseUrl);
    assert.equal(textResponse.statusCode, 201);
    assert.equal(textResponse.body, 'hello');
    const bufferResponse = await request(baseUrl, { responseType: 'buffer' });
    assert.deepEqual(bufferResponse.body, Buffer.from('hello'));
  });

  await withServer((_incoming, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('partial');
    response.destroy(new Error('synthetic response failure'));
  }, async baseUrl => {
    await assert.rejects(request(baseUrl), /unexpected response|network failure/);
  });

  for (const url of ['http://localhost:1', 'http://[::1]:1', 'https://127.0.0.1:1']) {
    await assert.rejects(request(url, { rejectUnauthorized: false }), /network failure|timeout/);
  }
  await assert.rejects(
    request('http://127.0.0.1:1', {}, { ...genericPolicy, allowHttp: 'any' }),
    /network failure|timeout/,
  );
});

test('shared bounded transport handles string chunks, array headers, missing status, and late response events once', async () => {
  const originalRequest = http.request;
  let mode = 'complete';
  http.request = (_url, _options, onResponse) => {
    if (mode === 'throw') { throw new Error('synthetic request-construction failure'); }
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.headers = { 'content-length': ['1'] };
      response.statusCode = undefined;
      response.destroy = () => {};
      onResponse(response);
      if (mode === 'error') {
        response.emit('error', new Error('synthetic'));
        return;
      }
      if (mode === 'aborted') {
        response.emit('aborted');
        response.emit('end');
        return;
      }
      response.emit('data', 'x');
      response.emit('end');
      response.emit('data', 'ignored after completion');
      response.emit('error', new Error('ignored after completion'));
    };
    return request;
  };
  try {
    const completed = await boundedHttpTransport({
      method: 'GET', url: 'http://localhost/mock', headers: {}, timeoutMs: 250, maxResponseBytes: 10,
    }, genericPolicy);
    assert.deepEqual({ statusCode: completed.statusCode, body: completed.body }, { statusCode: 0, body: 'x' });
    mode = 'error';
    await assert.rejects(boundedHttpTransport({
      method: 'GET', url: 'http://localhost/mock', headers: {}, timeoutMs: 250, maxResponseBytes: 10,
    }, genericPolicy), /unexpected response/);
    mode = 'aborted';
    await assert.rejects(boundedHttpTransport({
      method: 'GET', url: 'http://localhost/mock', headers: {}, timeoutMs: 250, maxResponseBytes: 10,
    }, genericPolicy), /unexpected response/);
    mode = 'throw';
    await assert.rejects(boundedHttpTransport({
      method: 'GET', url: 'http://localhost/mock', headers: {}, timeoutMs: 250, maxResponseBytes: 10,
    }, genericPolicy), /network failure/);
  } finally {
    http.request = originalRequest;
  }
});

test('default Jira transport handles loopback success, HTTP failure, response bounds, timeout, and cancellation', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.match(request.headers.authorization || '', /^Basic /);
    respondJson(response, 200, { issues: [], isLast: true });
  }, async baseUrl => {
    const result = await new JiraRestClient({ env: jiraEnv(baseUrl) }).searchWorkList();
    assert.equal(result.complete, true);
    assert.deepEqual(result.issues, []);
  });

  await withServer((_request, response) => respondJson(response, 401, { error: 'private response' }), async baseUrl => {
    await assert.rejects(
      new JiraRestClient({ env: jiraEnv(baseUrl) }).searchWorkList(),
      error => /HTTP 401.*credentials and permissions/i.test(error.message) && !/private response/.test(error.message),
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2048' });
    response.end('x'.repeat(2048));
  }, async baseUrl => {
    await assert.rejects(
      new JiraRestClient({ env: jiraEnv(baseUrl), maxResponseBytes: 1024 }).searchWorkList(),
      /1024-byte safety limit/,
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('x'.repeat(800));
    response.end('x'.repeat(800));
  }, async baseUrl => {
    await assert.rejects(
      new JiraRestClient({ env: jiraEnv(baseUrl), maxResponseBytes: 1024 }).searchWorkList(),
      /1024-byte safety limit/,
    );
  });

  await withServer(() => {}, async baseUrl => {
    await assert.rejects(
      new JiraRestClient({ env: jiraEnv(baseUrl) }).searchWorkList({ timeoutMs: 250 }),
      /Timed out after 250ms/,
    );
  });

  await withServer((_request, response) => {
    setTimeout(() => respondJson(response, 200, { issues: [], isLast: true }), 100);
  }, async baseUrl => {
    const controller = new AbortController();
    const pending = new JiraRestClient({ env: jiraEnv(baseUrl) }).searchWorkList({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, JiraRestCancelledError);
  });
});

test('default GitLab transport keeps tokens origin-pinned and bounds real loopback responses', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers['private-token'], 'fixture-token');
    assert.match(request.url, /^\/api\/v4\/projects\/group%2Fproject/);
    respondJson(response, 200, { id: 17 });
  }, async baseUrl => {
    const client = new GitLabRestClient({ env: gitlabEnv(baseUrl) });
    assert.equal(await client.projectId('group/project'), 17);
    assert.equal(await client.projectId('  '), null);
  });

  await withServer((_request, response) => respondJson(response, 403, { secret: 'hidden' }), async baseUrl => {
    await assert.rejects(
      new GitLabRestClient({ env: gitlabEnv(baseUrl) }).projectId('group/project'),
      error => /HTTP 403/i.test(error.message) && !/hidden/.test(error.message),
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2048' });
    response.end('x'.repeat(2048));
  }, async baseUrl => {
    await assert.rejects(
      new GitLabRestClient({ env: gitlabEnv(baseUrl), maxResponseBytes: 1024 }).projectId('group/project'),
      /1024-byte safety limit/,
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{not-json');
  }, async baseUrl => {
    await assert.rejects(
      new GitLabRestClient({ env: gitlabEnv(baseUrl) }).projectId('group/project'),
      /Invalid JSON/,
    );
  });

  await withServer(() => {}, async baseUrl => {
    await assert.rejects(
      new GitLabRestClient({ env: gitlabEnv(baseUrl) }).projectId('group/project', { timeoutMs: 250 }),
      /Timed out after 250ms/,
    );
  });
});

test('default Jenkins transport reads build status and classifies loopback transport failures', async () => {
  await withServer((request, response, baseUrl) => {
    assert.equal(request.method, 'GET');
    assert.match(request.url, /^\/job\/demo\/api\/json\?/);
    respondJson(response, 200, {
      lastBuild: {
        number: 9,
        result: 'SUCCESS',
        building: false,
        url: `${baseUrl}/job/demo/9/`,
        timestamp: 1_750_000_000_000,
        duration: 2_000,
        estimatedDuration: 2_100,
      },
    });
  }, async baseUrl => {
    const client = new JenkinsRestClient({ env: jenkinsEnv(baseUrl) });
    const result = await client.buildStatus(`${baseUrl}/job/demo/`);
    assert.equal(result.number, 9);
    assert.equal(result.status, 'SUCCESS');
  });

  await withServer((_request, response) => respondJson(response, 404, {}), async baseUrl => {
    await assert.rejects(
      new JenkinsRestClient({ env: jenkinsEnv(baseUrl) }).buildStatus(`${baseUrl}/job/demo/`),
      /HTTP 404.*job or build/i,
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2048' });
    response.end('x'.repeat(2048));
  }, async baseUrl => {
    await assert.rejects(
      new JenkinsRestClient({ env: jenkinsEnv(baseUrl), maxResponseBytes: 1024 }).buildStatus(`${baseUrl}/job/demo/`),
      /1024-byte safety limit/,
    );
  });

  await withServer(() => {}, async baseUrl => {
    await assert.rejects(
      new JenkinsRestClient({ env: jenkinsEnv(baseUrl) }).buildStatus(`${baseUrl}/job/demo/`, { timeoutMs: 250 }),
      /Timed out after 250ms/,
    );
  });
});

test('default SonarQube transport reads gate state and rejects unsafe real responses', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, 'Bearer fixture-token');
    assert.match(request.url, /^\/api\/qualitygates\/project_status\?/);
    respondJson(response, 200, { projectStatus: { status: 'OK', conditions: [] } });
  }, async baseUrl => {
    const result = await new SonarRestClient({ env: sonarEnv(baseUrl) }).qualityGateStatus('demo', 'main');
    assert.equal(result.status, 'OK');
    assert.deepEqual(result.conditions, []);
  });

  await withServer((_request, response) => respondJson(response, 429, { secret: 'hidden' }), async baseUrl => {
    await assert.rejects(
      new SonarRestClient({ env: sonarEnv(baseUrl) }).qualityGateStatus('demo', 'main'),
      error => /HTTP 429.*rate limiting/i.test(error.message) && !/hidden/.test(error.message),
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2048' });
    response.end('x'.repeat(2048));
  }, async baseUrl => {
    await assert.rejects(
      new SonarRestClient({ env: sonarEnv(baseUrl), maxResponseBytes: 1024 }).qualityGateStatus('demo', 'main'),
      /1024-byte safety limit/,
    );
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{not-json');
  }, async baseUrl => {
    await assert.rejects(
      new SonarRestClient({ env: sonarEnv(baseUrl) }).qualityGateStatus('demo', 'main'),
      /invalid JSON/,
    );
  });

  await withServer(() => {}, async baseUrl => {
    await assert.rejects(
      new SonarRestClient({ env: sonarEnv(baseUrl) }).qualityGateStatus('demo', 'main', { timeoutMs: 250 }),
      /Timed out after 250ms/,
    );
  });
});

function jiraEnv(baseUrl) {
  return { JIRA_BASE_URL: baseUrl, JIRA_EMAIL: 'fixture@example.test', JIRA_API_TOKEN: 'fixture-token' };
}

function gitlabEnv(baseUrl) {
  return { GITLAB_API_BASE_URL: `${baseUrl}/api/v4`, GITLAB_TOKEN: 'fixture-token' };
}

function jenkinsEnv(baseUrl) {
  return { JENKINS_URL: baseUrl };
}

function sonarEnv(baseUrl) {
  return { SONAR_HOST_URL: baseUrl, SONAR_TOKEN: 'fixture-token' };
}

function respondJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
  response.end(body);
}

async function withServer(handler, run) {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  server.on('request', (request, response) => handler(request, response, baseUrl));
  try {
    await run(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}
