/**
 * Tests for the analyze() decision tree — cli/core/ai.js
 * Only tests paths that don't make real API calls:
 *   - --fast mode (rules or mock, no network)
 *   - no-key mode (rules or mock fallback)
 * Run: node --test cli/tests/ai.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, chat } from '../core/ai.js';

const PROMPT = 'You are a DevOps expert. Analyze this log.';

const mockFn = (_log) => ({
  tool: 'mock-tool',
  severity: 'warning',
  summary: 'Mock analysis result',
  rootCause: 'Unknown',
  fixSteps: 'Check logs',
  commands: 'kubectl logs pod',
  confidence: 50,
});

// ── --fast mode ────────────────────────────────────────────────────────────

describe('analyze() — fast mode', () => {
  test('rule match → returns rule result, no mock called', async () => {
    const result = await analyze('CrashLoopBackOff detected', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result.via, 'rules');
    assert.strictEqual(result.severity, 'critical');
    assert.strictEqual(result.confidence, 95);
    assert.ok(!result._mock);
  });

  test('OOMKilled → rule result', async () => {
    const result = await analyze('Reason: OOMKilled Exit Code: 137', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result.via, 'rules');
    assert.strictEqual(result.confidence, 95);
  });

  test('no rule match → mock with _mock flag and via: mock', async () => {
    const result = await analyze('everything is healthy no issues', PROMPT, mockFn, { fast: true });
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'mock');
    assert.strictEqual(result.tool, 'mock-tool');
  });

  test('fast mode mock gets confidence set', async () => {
    const noConfMock = (_log) => ({ tool: 'x', severity: 'info', summary: '', rootCause: '', fixSteps: '', commands: '' });
    const result = await analyze('unrecognized log abc xyz', PROMPT, noConfMock, { fast: true });
    assert.ok(result.confidence != null);
    assert.strictEqual(result.confidence, 40);
  });
});

// ── no-key mode ────────────────────────────────────────────────────────────

describe('analyze() — no API keys', () => {
  let savedGroq, savedAnt;

  before(() => {
    savedGroq = process.env.GROQ_API_KEY;
    savedAnt  = process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  after(() => {
    if (savedGroq !== undefined) process.env.GROQ_API_KEY      = savedGroq;
    if (savedAnt  !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;
  });

  test('95%+ rule → returns rule directly, no _mock', async () => {
    const result = await analyze('CrashLoopBackOff', PROMPT, mockFn);
    assert.strictEqual(result.via, 'rules');
    assert.ok(result.confidence >= 95);
    assert.ok(!result._mock);
  });

  test('no rule match → calls mockFn, sets _mock + via: mock', async () => {
    const result = await analyze('totally unrecognized log xyzabc', PROMPT, mockFn);
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'mock');
    assert.strictEqual(result.tool, 'mock-tool');
  });

  test('low-confidence rule + no keys → rule result with _mock flag', async () => {
    // ci-timeout has confidence 78 — below 95 so falls through to no-key bottom
    const result = await analyze('Step exceeded the timeout limit of 30 minutes', PROMPT, mockFn);
    // Bottom of analyze(): ruleResult exists → returns rule with _mock=true
    assert.strictEqual(result._mock, true);
    assert.strictEqual(result.via, 'rules');
  });

  test('mock always gets confidence filled in', async () => {
    const noConfMock = (_log) => ({ tool: 'x', severity: 'info', summary: '', rootCause: '', fixSteps: '', commands: '' });
    const result = await analyze('unrecognized xyz', PROMPT, noConfMock);
    assert.strictEqual(result.confidence, 40);
  });
});

// ── result shape ───────────────────────────────────────────────────────────

describe('analyze() — result shape', () => {
  test('rule result always has required fields', async () => {
    const result = await analyze('ImagePullBackOff', PROMPT, mockFn, { fast: true });
    assert.ok(result.severity);
    assert.ok(result.summary);
    assert.ok(result.rootCause);
    assert.ok(result.fixSteps);
    assert.ok(result.commands);
    assert.ok(result.confidence);
    assert.ok(result.via);
    assert.ok(Array.isArray(result.suggestions));
  });
});

// ── Groq API path (mocked fetch) ───────────────────────────────────────────

describe('analyze() — Groq path', () => {
  let savedGroq, savedAnt, origFetch;

  before(() => {
    savedGroq  = process.env.GROQ_API_KEY;
    savedAnt   = process.env.ANTHROPIC_API_KEY;
    origFetch  = globalThis.fetch;
    process.env.GROQ_API_KEY = 'test-groq-key';
    delete process.env.ANTHROPIC_API_KEY;
  });

  after(() => {
    globalThis.fetch = origFetch;
    if (savedGroq !== undefined) process.env.GROQ_API_KEY      = savedGroq; else delete process.env.GROQ_API_KEY;
    if (savedAnt  !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;  else delete process.env.ANTHROPIC_API_KEY;
  });

  // Use a log that has no rule match (or <95 confidence) so it reaches Groq
  const noRuleLog = 'ANALYSIS_TEST_LOG_NO_RULE_MATCH_xyz';

  test('Groq success → via: ai-groq, default confidence 75', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          tool: 'kubernetes', severity: 'critical',
          summary: 'test', rootCause: 'test', fixSteps: 'test', commands: 'test',
        }) } }],
      }),
    });
    const result = await analyze(noRuleLog, PROMPT, mockFn);
    assert.strictEqual(result.via, 'ai-groq');
    assert.strictEqual(result.confidence, 75);
  });

  test('Groq success preserves confidence when AI includes it', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          tool: 'kubernetes', severity: 'warning',
          summary: 'test', rootCause: 'test', fixSteps: 'test', commands: 'test',
          confidence: 88,
        }) } }],
      }),
    });
    const result = await analyze(noRuleLog, PROMPT, mockFn);
    assert.strictEqual(result.via, 'ai-groq');
    assert.strictEqual(result.confidence, 88);
  });

  test('long input (>8000 chars) → _truncated=true', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          tool: 'ci', severity: 'info', summary: 'x', rootCause: 'x', fixSteps: 'x', commands: 'x',
        }) } }],
      }),
    });
    const result = await analyze('a '.repeat(5000), PROMPT, mockFn);
    assert.strictEqual(result._truncated, true);
  });

  test('low-confidence rule → Groq receives augmented prompt with rule hint', async () => {
    // ci-timeout has confidence 78 — falls through to Groq
    let capturedBody;
    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            tool: 'ci', severity: 'warning', summary: 'timeout', rootCause: 'x', fixSteps: 'x', commands: 'x',
          }) } }],
        }),
      };
    };
    await analyze('Step exceeded the timeout limit of 30 minutes', PROMPT, mockFn);
    const systemPrompt = capturedBody?.messages?.[0]?.content ?? '';
    assert.ok(systemPrompt.includes('Rule engine pre-match'), 'expected rule hint in prompt');
  });

  test('Groq rate_limit + no Anthropic + rule match (78%) → warning on rule result', async () => {
    // ci-timeout has confidence 78 — falls through to Groq, then falls back to rule on rate_limit
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ error: { message: 'rate_limit exceeded' } }),
    });
    const result = await analyze('Step exceeded the timeout limit of 30 minutes', PROMPT, mockFn);
    assert.ok(result._warning?.includes('Groq unavailable'));
    assert.strictEqual(result.via, 'rules');
  });

  test('Groq rate_limit + no keys + no rule → _warning on mock', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ error: { message: 'rate_limit exceeded' } }),
    });
    const result = await analyze(noRuleLog, PROMPT, mockFn);
    assert.ok(result._warning?.includes('Groq unavailable'));
    assert.strictEqual(result.via, 'mock');
  });

  test('Groq non-recoverable error (bad key) → throws', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ error: { message: 'invalid_api_key' } }),
    });
    await assert.rejects(
      () => analyze(noRuleLog, PROMPT, mockFn),
      (err) => { assert.ok(err instanceof Error); return true; }
    );
  });
});

// ── chat() ─────────────────────────────────────────────────────────────────

describe('chat()', () => {
  let savedGroq, savedAnt, origFetch;

  before(() => {
    savedGroq = process.env.GROQ_API_KEY;
    savedAnt  = process.env.ANTHROPIC_API_KEY;
    origFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = origFetch;
    if (savedGroq !== undefined) process.env.GROQ_API_KEY      = savedGroq; else delete process.env.GROQ_API_KEY;
    if (savedAnt  !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;  else delete process.env.ANTHROPIC_API_KEY;
  });

  const dummyResult = {
    tool: 'kubernetes', summary: 'Pod crashed', rootCause: 'OOM', fixSteps: 'Increase memory', commands: 'kubectl logs pod',
  };

  test('no API keys → returns demo string', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const answer = await chat('log text', dummyResult, []);
    assert.strictEqual(typeof answer, 'string');
    assert.ok(answer.length > 0);
  });

  test('Groq key → calls fetch and returns AI text (non-JSON mode)', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Check your pod logs for the OOM error.' } }],
      }),
    });
    const answer = await chat(
      'pod log', dummyResult,
      [{ role: 'user', content: 'What should I check first?' }]
    );
    assert.strictEqual(answer, 'Check your pod logs for the OOM error.');
  });
});
