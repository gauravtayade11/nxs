/**
 * Tests for cli/core/ui.js — hr, VERSION, providerInfo, TOOL_COLORS, TOOL_ICONS, printResult, printBanner
 * Run: node --test cli/tests/ui.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  hr, VERSION, providerInfo,
  TOOL_COLORS, TOOL_ICONS,
  printResult, printBanner, prompt, readStdin,
} from '../core/ui.js';

// Strip ANSI escape codes
// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1B\[[0-9;]*m/g, '');

// Silence console output for rendering tests
function withSilentStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = original; }
}

// ── hr() ──────────────────────────────────────────────────────────────────

describe('hr()', () => {
  test('default returns 60-char string', () => {
    const result = strip(hr());
    assert.strictEqual(result.length, 60);
  });

  test('custom length is respected', () => {
    assert.strictEqual(strip(hr(30)).length, 30);
    assert.strictEqual(strip(hr(80)).length, 80);
  });

  test('returns a string', () => {
    assert.strictEqual(typeof hr(), 'string');
  });
});

// ── VERSION ───────────────────────────────────────────────────────────────

describe('VERSION', () => {
  test('is a semver string', () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
  });

  test('is a string', () => {
    assert.strictEqual(typeof VERSION, 'string');
  });
});

// ── providerInfo() ────────────────────────────────────────────────────────

describe('providerInfo()', () => {
  let savedGroq, savedAnt;

  before(() => {
    savedGroq = process.env.GROQ_API_KEY;
    savedAnt  = process.env.ANTHROPIC_API_KEY;
  });

  after(() => {
    if (savedGroq !== undefined) process.env.GROQ_API_KEY      = savedGroq;
    else                         delete process.env.GROQ_API_KEY;
    if (savedAnt  !== undefined) process.env.ANTHROPIC_API_KEY = savedAnt;
    else                         delete process.env.ANTHROPIC_API_KEY;
  });

  test('no keys → DEMO label', () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const info = providerInfo();
    assert.ok(info.label.includes('DEMO'));
    assert.ok(typeof info.badge === 'function');
    assert.ok(typeof info.name  === 'string');
  });

  test('GROQ_API_KEY set → GROQ label', () => {
    process.env.GROQ_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_API_KEY;
    const info = providerInfo();
    assert.ok(info.label.includes('GROQ'));
  });

  test('ANTHROPIC_API_KEY set (no Groq) → CLAUDE label', () => {
    delete process.env.GROQ_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const info = providerInfo();
    assert.ok(info.label.includes('CLAUDE'));
  });

  test('GROQ takes precedence over Anthropic', () => {
    process.env.GROQ_API_KEY      = 'groq-key';
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const info = providerInfo();
    assert.ok(info.label.includes('GROQ'));
  });
});

// ── TOOL_COLORS / TOOL_ICONS ──────────────────────────────────────────────

describe('TOOL_COLORS and TOOL_ICONS', () => {
  test('both have kubernetes key', () => {
    assert.ok('kubernetes' in TOOL_COLORS);
    assert.ok('kubernetes' in TOOL_ICONS);
  });

  test('both have docker key', () => {
    assert.ok('docker' in TOOL_COLORS);
    assert.ok('docker' in TOOL_ICONS);
  });

  test('TOOL_COLORS values are functions (chalk formatters)', () => {
    for (const v of Object.values(TOOL_COLORS)) {
      assert.strictEqual(typeof v, 'function');
    }
  });

  test('TOOL_ICONS values are strings', () => {
    for (const v of Object.values(TOOL_ICONS)) {
      assert.strictEqual(typeof v, 'string');
    }
  });
});

// ── printResult() ─────────────────────────────────────────────────────────

describe('printResult()', () => {
  const baseResult = {
    tool: 'kubernetes', severity: 'critical',
    summary: 'Pod is CrashLoopBackOff',
    rootCause: 'App exits on startup',
    fixSteps: '1. Check logs\n2. Fix config',
    commands: 'kubectl logs pod --previous',
    via: 'rules', confidence: 95,
  };

  test('does not throw with a valid result', () => {
    assert.doesNotThrow(() => withSilentStdout(() => printResult(baseResult)));
  });

  test('handles _mock flag without throwing', () => {
    const r = { ...baseResult, via: 'mock', confidence: 40, _mock: true };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles _warning flag without throwing', () => {
    const r = { ...baseResult, _warning: 'Groq unavailable.' };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles _truncated flag without throwing', () => {
    const r = { ...baseResult, via: 'ai-groq', _truncated: true };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles array fixSteps', () => {
    const r = { ...baseResult, fixSteps: ['step 1', 'step 2', 'step 3'] };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles suggestions array', () => {
    const r = { ...baseResult, suggestions: ['Add monitoring', 'Set resource limits'] };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles impact field', () => {
    const r = { ...baseResult, impact: 'API is completely down for all users' };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles freq pattern data', () => {
    const freq = { count: 5, days: 7, lastSeen: new Date().toISOString() };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(baseResult, freq)));
  });

  test('handles via: ai-groq badge', () => {
    const r = { ...baseResult, via: 'ai-groq' };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles via: ai-anthropic badge', () => {
    const r = { ...baseResult, via: 'ai-anthropic' };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles unknown tool gracefully', () => {
    const r = { ...baseResult, tool: 'unknown' };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles commands as array', () => {
    const r = { ...baseResult, commands: ['kubectl logs pod', 'kubectl describe pod'] };
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });

  test('handles null/missing confidence', () => {
    const { confidence: _, ...r } = baseResult;
    assert.doesNotThrow(() => withSilentStdout(() => printResult(r)));
  });
});

// ── prompt() ──────────────────────────────────────────────────────────────

describe('prompt()', () => {
  test('resolves with the value passed to the readline callback', async () => {
    const mockRl = { question: (_q, cb) => cb('my-answer') };
    const answer = await prompt(mockRl, 'Enter: ');
    assert.strictEqual(answer, 'my-answer');
  });

  test('resolves with empty string when callback called with empty', async () => {
    const mockRl = { question: (_q, cb) => cb('') };
    const answer = await prompt(mockRl, 'Enter: ');
    assert.strictEqual(answer, '');
  });
});

// ── readStdin() ───────────────────────────────────────────────────────────

describe('readStdin()', () => {
  test('collects all data chunks until end event', async () => {
    const { PassThrough } = await import('node:stream');
    const origStdin = process.stdin;
    const mockStdin = new PassThrough();
    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true, writable: true });
    try {
      const promise = readStdin();
      mockStdin.emit('data', 'hello ');
      mockStdin.emit('data', 'world');
      mockStdin.emit('end');
      const result = await promise;
      assert.strictEqual(result, 'hello world');
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true, writable: true });
    }
  });

  test('resolves with empty string when stdin has no data', async () => {
    const { PassThrough } = await import('node:stream');
    const origStdin = process.stdin;
    const mockStdin = new PassThrough();
    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true, writable: true });
    try {
      const promise = readStdin();
      mockStdin.emit('end');
      const result = await promise;
      assert.strictEqual(result, '');
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true, writable: true });
    }
  });
});

// ── printBanner() ─────────────────────────────────────────────────────────

describe('printBanner()', () => {
  test('does not throw with subtitle', () => {
    assert.doesNotThrow(() => withSilentStdout(() => printBanner('test subtitle')));
  });

  test('does not throw with default args', () => {
    assert.doesNotThrow(() => withSilentStdout(() => printBanner()));
  });
});
