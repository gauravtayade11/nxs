import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Run a shell command, return { stdout, stderr, ok }
 * Never throws — caller decides what to do with errors.
 */
export async function run(cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: opts.timeout ?? 10000,
      ...opts,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err) {
    return {
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? err.message ?? '').trim(),
      ok: false,
    };
  }
}

/** Check if a CLI binary exists on PATH */
export async function hasBin(name) {
  const r = await run(`which ${name}`);
  return r.ok;
}

/** Parse tabular kubectl / helm output into array of objects */
export function parseTable(output) {
  const lines = output.split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  // Support both kubectl (multi-space) and helm (tab) column separators
  const split = (line) => line.trim().split(/\t|\s{2,}/).map((v) => v.trim()).filter((_, i, a) => i < a.length);
  const headers = split(lines[0]).map((h) => h.toLowerCase().replaceAll(/[^a-z0-9]/g, '_'));
  return lines.slice(1).map((line) => {
    const cols = split(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
}
