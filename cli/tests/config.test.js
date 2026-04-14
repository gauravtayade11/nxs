/**
 * Tests for cli/core/config.js
 * Backs up and restores real config/history files so no user data is lost.
 * Run: node --test cli/tests/config.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import {
  HISTORY_FILE, CONFIG_FILE,
  ensureConfigDir, loadConfig, saveConfig,
  loadHistory, saveHistory, addHistory,
  getPatternFrequency, applyConfig,
} from '../core/config.js';

// ── Backup / restore real files ────────────────────────────────────────────

let historyBackup = null;
let configBackup  = null;

before(() => {
  historyBackup = existsSync(HISTORY_FILE) ? readFileSync(HISTORY_FILE, 'utf8') : null;
  configBackup  = existsSync(CONFIG_FILE)  ? readFileSync(CONFIG_FILE,  'utf8') : null;
});

after(() => {
  if (historyBackup !== null) writeFileSync(HISTORY_FILE, historyBackup, 'utf8');
  else if (existsSync(HISTORY_FILE)) unlinkSync(HISTORY_FILE);

  if (configBackup !== null) writeFileSync(CONFIG_FILE, configBackup, 'utf8');
  else if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
});

// ── ensureConfigDir() ──────────────────────────────────────────────────────

describe('ensureConfigDir()', () => {
  test('does not throw when called', () => {
    assert.doesNotThrow(() => ensureConfigDir());
  });
});

// ── loadConfig() / saveConfig() ────────────────────────────────────────────

describe('loadConfig() / saveConfig()', () => {
  test('round-trip: saved value can be read back', () => {
    saveConfig({ GROQ_API_KEY: 'round-trip-test' });
    const cfg = loadConfig();
    assert.strictEqual(cfg.GROQ_API_KEY, 'round-trip-test');
  });

  test('multiple keys preserved', () => {
    saveConfig({ GROQ_API_KEY: 'g-key', SLACK_WEBHOOK_URL: 's-url' });
    const cfg = loadConfig();
    assert.strictEqual(cfg.GROQ_API_KEY, 'g-key');
    assert.strictEqual(cfg.SLACK_WEBHOOK_URL, 's-url');
  });

  test('missing config file returns empty object', () => {
    if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
    const cfg = loadConfig();
    assert.deepStrictEqual(cfg, {});
  });

  test('corrupt config JSON returns empty object', () => {
    writeFileSync(CONFIG_FILE, 'not valid json{{', 'utf8');
    const cfg = loadConfig();
    assert.deepStrictEqual(cfg, {});
  });
});

// ── addHistory() / loadHistory() ───────────────────────────────────────────

describe('addHistory() / loadHistory()', () => {
  before(() => saveHistory([]));

  test('addHistory creates a retrievable entry', () => {
    addHistory('ci', 'some ci log', {
      tool: 'ci', severity: 'critical', summary: 'Build failed',
      via: 'rules', confidence: 90,
    });
    const entries = loadHistory();
    assert.ok(entries.length >= 1);
    assert.strictEqual(entries[0].toolModule, 'ci');
    assert.strictEqual(entries[0].summary, 'Build failed');
  });

  test('loadHistory() with tool filter returns only matching entries', () => {
    addHistory('k8s', 'kube log', {
      tool: 'kubernetes', severity: 'warning', summary: 'OOMKilled',
      via: 'mock', confidence: 50,
    });
    const ciOnly = loadHistory('ci');
    assert.ok(ciOnly.every((e) => e.toolModule === 'ci'));
  });

  test('entries are prepended (newest first)', () => {
    saveHistory([]);
    addHistory('ci', 'log1', { tool: 'ci', severity: 'info', summary: 'first',  via: 'rules', confidence: 80 });
    addHistory('ci', 'log2', { tool: 'ci', severity: 'info', summary: 'second', via: 'rules', confidence: 80 });
    const entries = loadHistory('ci');
    assert.strictEqual(entries[0].summary, 'second');
    assert.strictEqual(entries[1].summary, 'first');
  });

  test('logPreview is truncated to 200 chars', () => {
    saveHistory([]);
    const longLog = 'x'.repeat(500);
    addHistory('ci', longLog, { tool: 'ci', severity: 'info', summary: 'test', via: 'rules', confidence: 80 });
    const entries = loadHistory('ci');
    assert.ok(entries[0].logPreview.length <= 200);
  });

  test('entry includes timestamp and id', () => {
    saveHistory([]);
    addHistory('ci', 'log', { tool: 'ci', severity: 'critical', summary: 'x', via: 'rules', confidence: 95 });
    const entries = loadHistory('ci');
    assert.ok(typeof entries[0].id        === 'number');
    assert.ok(typeof entries[0].timestamp === 'string');
  });

  test('loadHistory() with no history file returns empty array', () => {
    if (existsSync(HISTORY_FILE)) unlinkSync(HISTORY_FILE);
    assert.deepStrictEqual(loadHistory(), []);
  });

  test('corrupt history JSON returns empty array', () => {
    writeFileSync(HISTORY_FILE, 'not valid json{{', 'utf8');
    assert.deepStrictEqual(loadHistory(), []);
  });

  test('addHistory with via !== rules uses tool:severity as errorTag', () => {
    saveHistory([]);
    addHistory('k8s', 'log', { tool: 'kubernetes', severity: 'warning', summary: 'x', via: 'ai-groq', confidence: 80 });
    const entries = loadHistory('k8s');
    assert.strictEqual(entries[0].errorTag, 'kubernetes:warning');
  });
});

// ── getPatternFrequency() ──────────────────────────────────────────────────

describe('getPatternFrequency()', () => {
  before(() => saveHistory([]));

  test('null errorTag returns null', () => {
    assert.strictEqual(getPatternFrequency(null, 7), null);
  });

  test('single occurrence returns null', () => {
    addHistory('ci', 'log', {
      tool: 'ci', severity: 'critical', summary: 'fail', via: 'rules', confidence: 95,
    });
    const entries = loadHistory('ci');
    const freq = getPatternFrequency(entries[0].errorTag, 7);
    assert.strictEqual(freq, null);
  });

  test('three occurrences of same tag returns count=3', () => {
    saveHistory([]);
    const fakeResult = { tool: 'ci', severity: 'critical', summary: 'fail', via: 'rules', confidence: 95, id: 'ci-npm-test' };
    addHistory('ci', 'log', fakeResult);
    addHistory('ci', 'log', fakeResult);
    addHistory('ci', 'log', fakeResult);

    const freq = getPatternFrequency('ci-npm-test', 7);
    assert.ok(freq !== null);
    assert.strictEqual(freq.count, 3);
    assert.strictEqual(freq.days, 7);
    assert.ok(typeof freq.lastSeen  === 'string');
    assert.ok(typeof freq.firstSeen === 'string');
  });

  test('different errorTags are not conflated', () => {
    saveHistory([]);
    const r1 = { tool: 'ci', severity: 'critical', summary: 'a', via: 'rules', confidence: 95, id: 'rule-a' };
    const r2 = { tool: 'ci', severity: 'warning',  summary: 'b', via: 'rules', confidence: 95, id: 'rule-b' };
    addHistory('ci', 'log', r1);
    addHistory('ci', 'log', r1);
    addHistory('ci', 'log', r2);

    const freqA = getPatternFrequency('rule-a', 7);
    const freqB = getPatternFrequency('rule-b', 7);
    assert.ok(freqA !== null);
    assert.strictEqual(freqA.count, 2);
    assert.strictEqual(freqB, null); // only 1 occurrence of rule-b
  });
});

// ── applyConfig() ──────────────────────────────────────────────────────────

describe('applyConfig()', () => {
  let savedKeys;

  before(() => {
    savedKeys = {
      GROQ:    process.env.GROQ_API_KEY,
      ANT:     process.env.ANTHROPIC_API_KEY,
      TOKEN:   process.env.SLACK_BOT_TOKEN,
      CHANNEL: process.env.SLACK_CHANNEL,
      WEBHOOK: process.env.SLACK_WEBHOOK_URL,
    };
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL;
    delete process.env.SLACK_WEBHOOK_URL;
    saveConfig({
      GROQ_API_KEY: 'from-config',
      ANTHROPIC_API_KEY: 'ant-from-config',
      SLACK_BOT_TOKEN: 'token-from-config',
      SLACK_CHANNEL: '#alerts',
      SLACK_WEBHOOK_URL: 'https://hooks.example.com',
    });
  });

  after(() => {
    const restoreOrDelete = (envKey, saved) => {
      if (saved !== undefined) process.env[envKey] = saved;
      else delete process.env[envKey];
    };
    restoreOrDelete('GROQ_API_KEY', savedKeys.GROQ);
    restoreOrDelete('ANTHROPIC_API_KEY', savedKeys.ANT);
    restoreOrDelete('SLACK_BOT_TOKEN', savedKeys.TOKEN);
    restoreOrDelete('SLACK_CHANNEL', savedKeys.CHANNEL);
    restoreOrDelete('SLACK_WEBHOOK_URL', savedKeys.WEBHOOK);
  });

  test('sets all env vars from config when not already set', () => {
    applyConfig();
    assert.strictEqual(process.env.GROQ_API_KEY, 'from-config');
    assert.strictEqual(process.env.ANTHROPIC_API_KEY, 'ant-from-config');
    assert.strictEqual(process.env.SLACK_BOT_TOKEN, 'token-from-config');
    assert.strictEqual(process.env.SLACK_CHANNEL, '#alerts');
    assert.strictEqual(process.env.SLACK_WEBHOOK_URL, 'https://hooks.example.com');
  });

  test('does not overwrite already-set env vars', () => {
    process.env.GROQ_API_KEY = 'already-set';
    applyConfig();
    assert.strictEqual(process.env.GROQ_API_KEY, 'already-set');
  });
});
