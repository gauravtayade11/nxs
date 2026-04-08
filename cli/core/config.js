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
  all.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    toolModule,
    tool: result.tool,
    summary: result.summary,
    logPreview: logText.slice(0, 200),
    result,
  });
  saveHistory(all.slice(0, 50));
}

export function applyConfig() {
  const cfg = loadConfig();
  if (cfg.GROQ_API_KEY && !process.env.GROQ_API_KEY)           process.env.GROQ_API_KEY = cfg.GROQ_API_KEY;
  if (cfg.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = cfg.ANTHROPIC_API_KEY;
}
