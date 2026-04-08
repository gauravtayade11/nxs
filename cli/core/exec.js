import { execSync, exec } from 'child_process';
import { promisify } from 'util';

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
  const headers = lines[0].trim().split(/\s{2,}/).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  return lines.slice(1).map((line) => {
    const cols = line.trim().split(/\s{2,}/);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
}
