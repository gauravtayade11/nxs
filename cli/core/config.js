import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const CONFIG_DIR   = join(homedir(), '.nxs');
export const CONFIG_FILE  = join(CONFIG_DIR, 'config.json');
export const HISTORY_FILE = join(CONFIG_DIR, 'history.json');

export function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig() {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

export function saveConfig(cfg) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function loadHistory(tool = null) {
  ensureConfigDir();
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const all = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    return tool ? all.filter((e) => e.toolModule === tool) : all;
  } catch { return []; }
}

export function saveHistory(entries) {
  ensureConfigDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2));
}

export function addHistory(toolModule, logText, result) {
  const all = loadHistory();

  // Extract a canonical error tag for frequency tracking
  // (the rule id if matched by rules, otherwise the tool + severity)
  const errorTag = result.via === 'rules' && result.id
    ? result.id
    : `${result.tool ?? toolModule}:${result.severity ?? 'info'}`;

  all.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    toolModule,
    tool: result.tool,
    severity: result.severity ?? 'info',
    confidence: result.confidence ?? null,
    via: result.via ?? 'unknown',
    errorTag,
    summary: result.summary,
    logPreview: logText.slice(0, 200),
    result,
  });
  saveHistory(all.slice(0, 100)); // keep more history for frequency analysis
}

/**
 * Count how many times an errorTag appeared in the last N days.
 * Returns { count, firstSeen, lastSeen } or null if only 1 occurrence.
 */
export function getPatternFrequency(errorTag, days = 7) {
  if (!errorTag) return null;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = loadHistory();
  const matches = all.filter(
    (e) => e.errorTag === errorTag && new Date(e.timestamp).getTime() > since
  );
  if (matches.length <= 1) return null;
  return {
    count: matches.length,
    days,
    firstSeen: matches[matches.length - 1]?.timestamp,
    lastSeen: matches[0]?.timestamp,
  };
}

export function applyConfig() {
  const cfg = loadConfig();
  if (cfg.GROQ_API_KEY && !process.env.GROQ_API_KEY)           process.env.GROQ_API_KEY = cfg.GROQ_API_KEY;
  if (cfg.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = cfg.ANTHROPIC_API_KEY;
  if (cfg.SLACK_BOT_TOKEN && !process.env.SLACK_BOT_TOKEN)     process.env.SLACK_BOT_TOKEN = cfg.SLACK_BOT_TOKEN;
  if (cfg.SLACK_CHANNEL && !process.env.SLACK_CHANNEL)         process.env.SLACK_CHANNEL = cfg.SLACK_CHANNEL;
  if (cfg.SLACK_WEBHOOK_URL && !process.env.SLACK_WEBHOOK_URL) process.env.SLACK_WEBHOOK_URL = cfg.SLACK_WEBHOOK_URL;
}
