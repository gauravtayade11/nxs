/**
 * Dependency checker — warns when an external CLI tool is missing
 * before a command that needs it tries to run.
 *
 * Usage:
 *   import { checkDeps } from '../core/deps.js';
 *   await checkDeps('kubectl', 'helm');   // warns + returns false if any missing
 */
import chalk from 'chalk';
import { hasBin } from './exec.js';

// Map: external tool → install hint
const INSTALL_HINTS = {
  kubectl: 'brew install kubectl          or  https://kubernetes.io/docs/tasks/tools/',
  helm:    'brew install helm             or  https://helm.sh/docs/intro/install/',
  gh:      'brew install gh              or  https://cli.github.com/',
  trivy:   'brew install trivy            or  https://aquasecurity.github.io/trivy/',
  git:     'brew install git              or  https://git-scm.com/downloads',
  docker:  'https://docs.docker.com/get-docker/',
};

/**
 * Check that each listed tool is on PATH.
 * Prints a clear error for each missing tool.
 * Returns true if ALL present, false if any missing.
 */
export async function checkDeps(...tools) {
  const results = await Promise.all(
    tools.map(async (t) => ({ tool: t, found: await hasBin(t) }))
  );
  const missing = results.filter(r => !r.found);
  if (missing.length === 0) return true;

  console.error('');
  console.error(chalk.red.bold('  Missing required tools:\n'));
  for (const { tool } of missing) {
    const hint = INSTALL_HINTS[tool] ?? `install ${tool}`;
    console.error(`  ${chalk.red('✗')} ${chalk.white.bold(tool.padEnd(10))}  ${chalk.dim(hint)}`);
  }
  console.error('');
  return false;
}

/**
 * Soft check — same as checkDeps but only prints a warning, doesn't block.
 * Use for optional tools (e.g. helm in nxs status).
 */
export async function warnMissingDeps(...tools) {
  const results = await Promise.all(
    tools.map(async (t) => ({ tool: t, found: await hasBin(t) }))
  );
  const missing = results.filter(r => !r.found);
  for (const { tool } of missing) {
    const hint = INSTALL_HINTS[tool] ?? `install ${tool}`;
    console.error(chalk.yellow(`  ⚠  ${tool} not found — some features unavailable  (${hint})`));
  }
}
