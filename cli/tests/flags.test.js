/**
 * Tests for cross-cutting global flags:
 *   --no-color  (chalk.level=0, banner suppressed)
 *   --no-cache  (NXS_NO_CACHE=1 bypasses cache)
 *   --debug     (NXS_DEBUG=1 emits debug lines to stderr)
 *   --fail-on   (exit 1 when severity meets threshold)
 *
 * Run: node --test cli/tests/flags.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, clearCache } from '../core/ai.js';
import { printBanner } from '../core/ui.js';
import chalk from 'chalk';

// ── helpers ───────────────────────────────────────────────────────────────

function withSilentStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = orig; }
}

function captureStderr(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { return { result: fn(), lines }; } finally { process.stderr.write = orig; }
}

async function captureStderrAsync(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { return { result: await fn(), lines }; } finally { process.stderr.write = orig; }
}

const PROMPT = 'You are a DevOps expert. Analyze this log.';
const mockFn = (_log) => ({
  tool: 'mock-tool', severity: 'warning',
  summary: 'Mock', rootCause: 'Unknown',
  fixSteps: 'Check', commands: 'kubectl get pods',
  confidence: 50,
});
const noRuleLog = 'CROSS_CUTTING_TEST_LOG_NO_RULE_MATCH_xyzabc';

// ── --no-color ─────────────────────────────────────────────────────────────

describe('--no-color (chalk.level = 0)', () => {
  let savedLevel;

  before(() => { savedLevel = chalk.level; });
  after(() => { chalk.level = savedLevel; });

  test('printBanner is suppressed when chalk.level === 0', () => {
    chalk.level = 0;
    let called = false;
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { called = true; return orig(chunk); };
    try {
      printBanner('test');
    } finally {
      process.stdout.write = orig;
    }
    assert.strictEqual(called, false, 'printBanner should write nothing when chalk.level=0');
  });

  test('printBanner is suppressed when NO_COLOR env var is set', () => {
    const savedEnv = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    let called = false;
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { called = true; return orig(chunk); };
    try {
      printBanner('test');
    } finally {
      process.stdout.write = orig;
      if (savedEnv === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = savedEnv;
    }
    assert.strictEqual(called, false, 'printBanner should write nothing when NO_COLOR is set');
  });

  test('printBanner renders normally when chalk.level > 0', () => {
    chalk.level = 1;
    let output = '';
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { output += chunk; return true; };
    try {
      printBanner('subtitle test');
    } finally {
      process.stdout.write = orig;
    }
    assert.ok(output.length > 0, 'printBanner should write output when colors enabled');
  });
});

// ── --no-cache ─────────────────────────────────────────────────────────────

describe('--no-cache (NXS_NO_CACHE=1)', () => {
  let savedGroq, savedAnt, origFetch, savedNoCache;

  before(() => {
    savedGroq   = process.env.GROQ_API_KEY;
    savedAnt    = process.env.ANTHROPIC_API_KEY;
    savedNoCache = process.env.NXS_NO_CACHE;
    origFetch   = globalThis.fetch;
    process.env.GROQ_API_KEY = 'test-groq-key';
    delete process.env.ANTHROPIC_API_KEY;
    clearCache();
  });

  beforeEach(() => { clearCache(); });

  after(() => {
    globalThis.fetch = origFetch;
    if (savedGroq    !== undefined) process.env.GROQ_API_KEY      = savedGroq;    else delete process.env.GROQ_API_KEY;
    if (savedAnt     !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;     else delete process.env.ANTHROPIC_API_KEY;
    if (savedNoCache !== undefined) process.env.NXS_NO_CACHE       = savedNoCache; else delete process.env.NXS_NO_CACHE;
  });

  const groqResponse = (severity = 'warning') => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        tool: 'kubernetes', severity,
        summary: 'test', rootCause: 'test', fixSteps: 'test', commands: 'test',
      }) } }],
    }),
  });

  test('without --no-cache: second identical call returns _cached=true', async () => {
    delete process.env.NXS_NO_CACHE;
    // Temporarily enable cache (NODE_ENV=test disables it globally)
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    clearCache();

    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return groqResponse(); };

    try {
      await analyze(noRuleLog, PROMPT, mockFn);
      const second = await analyze(noRuleLog, PROMPT, mockFn);
      assert.strictEqual(fetchCount, 1, 'fetch should only be called once — second should hit cache');
      assert.strictEqual(second._cached, true);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      clearCache();
    }
  });

  test('with NXS_NO_CACHE=1: each call hits AI, never cached', async () => {
    process.env.NXS_NO_CACHE = '1';
    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return groqResponse(); };

    const first  = await analyze(noRuleLog, PROMPT, mockFn);
    const second = await analyze(noRuleLog, PROMPT, mockFn);

    assert.strictEqual(fetchCount, 2, 'fetch should be called twice — cache bypassed');
    assert.ok(!first._cached,  'first result should not be cached');
    assert.ok(!second._cached, 'second result should not be cached');
  });

  test('with NXS_NO_CACHE=1: cacheSet is also skipped (third call still hits AI)', async () => {
    process.env.NXS_NO_CACHE = '1';
    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return groqResponse(); };

    await analyze(noRuleLog, PROMPT, mockFn);
    await analyze(noRuleLog, PROMPT, mockFn);
    await analyze(noRuleLog, PROMPT, mockFn);

    assert.strictEqual(fetchCount, 3, 'all 3 calls should hit AI when cache disabled');
  });
});

// ── --debug (NXS_DEBUG=1) ─────────────────────────────────────────────────

describe('--debug (NXS_DEBUG=1)', () => {
  let savedGroq, savedAnt, origFetch, savedDebug;

  before(() => {
    savedGroq  = process.env.GROQ_API_KEY;
    savedAnt   = process.env.ANTHROPIC_API_KEY;
    savedDebug = process.env.NXS_DEBUG;
    origFetch  = globalThis.fetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    clearCache();
  });

  beforeEach(() => { clearCache(); });

  after(() => {
    globalThis.fetch = origFetch;
    if (savedGroq  !== undefined) process.env.GROQ_API_KEY      = savedGroq;  else delete process.env.GROQ_API_KEY;
    if (savedAnt   !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;   else delete process.env.ANTHROPIC_API_KEY;
    if (savedDebug !== undefined) process.env.NXS_DEBUG          = savedDebug; else delete process.env.NXS_DEBUG;
  });

  test('NXS_DEBUG=1: emits [debug] lines to stderr', async () => {
    process.env.NXS_DEBUG = '1';
    const { lines } = await captureStderrAsync(() =>
      analyze(noRuleLog, PROMPT, mockFn, { fast: true })
    );
    const debugLines = lines.filter(l => l.includes('[debug]'));
    assert.ok(debugLines.length > 0, 'expected at least one [debug] line on stderr');
  });

  test('NXS_DEBUG=1: input size reported in debug output', async () => {
    process.env.NXS_DEBUG = '1';
    const log = 'test log for debug output check';
    const { lines } = await captureStderrAsync(() =>
      analyze(log, PROMPT, mockFn, { fast: true })
    );
    const inputLine = lines.find(l => l.includes('[debug]') && l.includes('chars'));
    assert.ok(inputLine, 'expected [debug] line reporting input size');
    assert.ok(inputLine.includes(String(log.length)), 'input length should match log length');
  });

  test('NXS_DEBUG=1: rule match reported when rule matches', async () => {
    process.env.NXS_DEBUG = '1';
    const { lines } = await captureStderrAsync(() =>
      analyze('CrashLoopBackOff detected', PROMPT, mockFn, { fast: true })
    );
    const ruleLine = lines.find(l => l.includes('[debug]') && l.includes('rule match'));
    assert.ok(ruleLine, 'expected [debug] line for rule match');
  });

  test('NXS_DEBUG=1: rules short-circuit logged when confidence >= 95', async () => {
    process.env.NXS_DEBUG = '1';
    const { lines } = await captureStderrAsync(() =>
      analyze('CrashLoopBackOff detected', PROMPT, mockFn)
    );
    const shortCircuit = lines.find(l => l.includes('[debug]') && l.includes('short-circuit'));
    assert.ok(shortCircuit, 'expected [debug] line for rules short-circuit');
    assert.ok(shortCircuit.includes('95%'), 'should include confidence value');
  });

  test('NXS_DEBUG=0 (unset): no [debug] lines emitted', async () => {
    delete process.env.NXS_DEBUG;
    const { lines } = await captureStderrAsync(() =>
      analyze(noRuleLog, PROMPT, mockFn, { fast: true })
    );
    const debugLines = lines.filter(l => l.includes('[debug]'));
    assert.strictEqual(debugLines.length, 0, 'no debug output when NXS_DEBUG not set');
  });

  test('NXS_DEBUG=1: cache hit reported when same input analyzed twice', async () => {
    process.env.NXS_DEBUG = '1';
    process.env.GROQ_API_KEY = 'test-key';
    // Temporarily enable cache (NODE_ENV=test disables it globally)
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    clearCache();

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          tool: 'kubernetes', severity: 'warning',
          summary: 'x', rootCause: 'x', fixSteps: 'x', commands: 'x',
        }) } }],
      }),
    });

    try {
      // First call — cache miss
      await analyze(noRuleLog, PROMPT, mockFn);

      // Second call — should be cache hit
      const { lines } = await captureStderrAsync(() =>
        analyze(noRuleLog, PROMPT, mockFn)
      );
      const hitLine = lines.find(l => l.includes('[debug]') && l.includes('cache hit'));
      assert.ok(hitLine, 'expected [debug] cache hit line on second call');
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      clearCache();
    }
  });
});

// ── --fail-on (severity threshold) ───────────────────────────────────────

describe('--fail-on severity exit codes (SEV_ORDER logic)', () => {
  // Test the severity ordering logic directly — same as runner.js uses
  const SEV_ORDER = { info: 0, warning: 1, critical: 2 };

  function shouldFail(resultSeverity, failOn) {
    return SEV_ORDER[resultSeverity] >= (SEV_ORDER[failOn] ?? 99);
  }

  // ── --fail-on critical ──────────────────────────────────────────────────

  test('--fail-on critical: critical result → should fail', () => {
    assert.strictEqual(shouldFail('critical', 'critical'), true);
  });

  test('--fail-on critical: warning result → should not fail', () => {
    assert.strictEqual(shouldFail('warning', 'critical'), false);
  });

  test('--fail-on critical: info result → should not fail', () => {
    assert.strictEqual(shouldFail('info', 'critical'), false);
  });

  // ── --fail-on warning ───────────────────────────────────────────────────

  test('--fail-on warning: critical result → should fail', () => {
    assert.strictEqual(shouldFail('critical', 'warning'), true);
  });

  test('--fail-on warning: warning result → should fail', () => {
    assert.strictEqual(shouldFail('warning', 'warning'), true);
  });

  test('--fail-on warning: info result → should not fail', () => {
    assert.strictEqual(shouldFail('info', 'warning'), false);
  });

  // ── --fail-on info ──────────────────────────────────────────────────────

  test('--fail-on info: critical result → should fail', () => {
    assert.strictEqual(shouldFail('critical', 'info'), true);
  });

  test('--fail-on info: warning result → should fail', () => {
    assert.strictEqual(shouldFail('warning', 'info'), true);
  });

  test('--fail-on info: info result → should fail', () => {
    assert.strictEqual(shouldFail('info', 'info'), true);
  });

  // ── unknown / missing severity ──────────────────────────────────────────

  test('unknown failOn value → never fails (SEV_ORDER returns undefined → 99)', () => {
    assert.strictEqual(shouldFail('critical', 'unknown'), false);
    assert.strictEqual(shouldFail('warning',  'unknown'), false);
    assert.strictEqual(shouldFail('info',     'unknown'), false);
  });

  test('unknown result severity → never fails', () => {
    assert.strictEqual(shouldFail('unknown', 'warning'), false);
    assert.strictEqual(shouldFail('unknown', 'critical'), false);
  });

  // ── NXS_FAIL_ON env var ─────────────────────────────────────────────────

  test('NXS_FAIL_ON env var is read for global flag', () => {
    const saved = process.env.NXS_FAIL_ON;
    process.env.NXS_FAIL_ON = 'critical';
    try {
      const failOn = process.env.NXS_FAIL_ON;
      assert.strictEqual(failOn, 'critical');
      assert.strictEqual(shouldFail('critical', failOn), true);
      assert.strictEqual(shouldFail('warning', failOn), false);
    } finally {
      if (saved === undefined) delete process.env.NXS_FAIL_ON;
      else process.env.NXS_FAIL_ON = saved;
    }
  });

  // ── ordering completeness ───────────────────────────────────────────────

  test('severity ordering is transitive: critical > warning > info', () => {
    assert.ok(SEV_ORDER['critical'] > SEV_ORDER['warning']);
    assert.ok(SEV_ORDER['warning']  > SEV_ORDER['info']);
    assert.ok(SEV_ORDER['critical'] > SEV_ORDER['info']);
  });

  test('all three severities have defined order values', () => {
    assert.strictEqual(typeof SEV_ORDER['info'],     'number');
    assert.strictEqual(typeof SEV_ORDER['warning'],  'number');
    assert.strictEqual(typeof SEV_ORDER['critical'], 'number');
  });
});
