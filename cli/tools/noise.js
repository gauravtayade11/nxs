/**
 * nxs noise — Alert fatigue analyzer
 * Scores each alert by fire frequency vs actionability to identify noise.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { loadHistory } from '../core/config.js';
import { analyze } from '../core/ai.js';

const SYSTEM_PROMPT = `You are a Site Reliability Engineer analyzing alert patterns for noise and fatigue.
Given a list of alerts with their fire counts and auto-resolution rates, identify which are noise.

Return a JSON object with exactly this structure:
{
  "tool": "noise",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary of overall alert health>",
  "noiseAlerts": [
    { "name": "<alert name>", "reason": "<why it is noise>", "recommendation": "<suppress/tune/fix>" }
  ],
  "actionableAlerts": [
    { "name": "<alert name>", "reason": "<why it needs attention>" }
  ],
  "rootCause": "<overall pattern causing noise — e.g. thresholds too low, missing alert grouping>",
  "fixSteps": "<numbered steps to reduce alert fatigue>",
  "commands": "<alertmanager or kubectl commands to suppress or tune alerts>"
}

Return ONLY valid JSON. No markdown fences.`;

function scoreNoise(alerts) {
  return alerts.map((a) => {
    // Noise score 0-100: high fires + high auto-resolve = noise
    const fireScore   = Math.min(a.fires / 10, 1) * 50;      // up to 50pts for frequency
    const resolveScore = (a.autoResolved / Math.max(a.fires, 1)) * 30; // up to 30pts for auto-resolve
    const noActionScore = ((a.fires - a.actioned) / Math.max(a.fires, 1)) * 20; // up to 20pts for no action
    a.noiseScore = Math.round(fireScore + resolveScore + noActionScore);
    a.isNoise = a.noiseScore >= 50;
    return a;
  }).sort((a, b) => b.noiseScore - a.noiseScore);
}

async function fetchFromAlertmanager(url, _days) {
  try {
    const res = await fetch(`${url}/api/v2/alerts?silenced=false&inhibited=false`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const active = await res.json();

    // Also fetch silences to understand what's already suppressed
    const silRes = await fetch(`${url}/api/v2/silences`);
    const silences = silRes.ok ? await silRes.json() : [];

    // Group active alerts by alertname
    // Use Object.create(null) to prevent prototype pollution from external alertname values
    const groups = Object.create(null);
    for (const a of active) {
      const name = a.labels?.alertname ?? 'unknown';
      if (!groups[name]) groups[name] = { fires: 0, autoResolved: 0, actioned: 0, severity: a.labels?.severity ?? 'info', lastSeen: a.startsAt };
      groups[name].fires++;
      if (a.status?.state === 'resolved') groups[name].autoResolved++;
      groups[name].lastSeen = a.startsAt > groups[name].lastSeen ? a.startsAt : groups[name].lastSeen;
    }

    const silencedNames = new Set(silences.filter(s => s.status?.state === 'active').flatMap(s => s.matchers?.map(m => m.value) ?? []));

    return Object.entries(groups).map(([name, g]) => ({ name, ...g, silenced: silencedNames.has(name) }));
  } catch {
    return null;
  }
}

function buildFromHistory(days) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = loadHistory().filter((e) =>
    new Date(e.timestamp).getTime() > since &&
    (e.toolModule === 'alertmanager' || e.tool?.includes('alert') || e.toolModule === 'k8s' || e.toolModule === 'ci')
  );

  const groups = {};
  for (const e of entries) {
    const name = e.tool ?? e.toolModule ?? 'unknown';
    if (!groups[name]) groups[name] = { fires: 0, autoResolved: 0, actioned: 0, severity: e.severity ?? 'info' };
    groups[name].fires++;
    if (e.severity === 'info') groups[name].autoResolved++; // info = likely auto-resolved
    if (e.severity === 'critical' || e.severity === 'warning') groups[name].actioned++;
  }

  return Object.entries(groups).map(([name, g]) => ({ name, ...g, silenced: false }));
}

export function registerNoise(program) {
  program
    .command('noise')
    .description('Analyze alert history to identify noise and reduce alert fatigue')
    .option('--alertmanager <url>', 'Alertmanager base URL (e.g. http://localhost:9093)')
    .option('--days <n>', 'Look-back window in days', '30')
    .option('--threshold <n>', 'Noise score threshold 0-100 (default: 50)', '50')
    .option('--ai', 'Use AI to generate suppression recommendations')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs noise
  $ nxs noise --alertmanager http://localhost:9093
  $ nxs noise --days 7 --threshold 60
  $ nxs noise --ai`)
    .action(async (opts) => {
      const days = Number.parseInt(opts.days, 10) || 30;
      const threshold = Number.parseInt(opts.threshold, 10) || 50;

      if (!opts.json) printBanner('Alert noise analyzer');

      let rawAlerts = [];

      if (opts.alertmanager) {
        if (!opts.json) console.log(chalk.dim(`  Querying Alertmanager: ${opts.alertmanager}\n`));
        rawAlerts = await fetchFromAlertmanager(opts.alertmanager, days);
        if (!rawAlerts) {
          console.error(chalk.red('  Could not reach Alertmanager. Check the URL and try again.'));
          process.exit(1);
        }
      } else {
        if (!opts.json) console.log(chalk.dim(`  Analyzing nxs history (last ${days} days)…\n`));
        rawAlerts = buildFromHistory(days);
      }

      if (rawAlerts.length === 0) {
        if (!opts.json) {
          console.log(chalk.dim('  No alert data found.\n'));
          if (!opts.alertmanager) console.log(chalk.dim('  Tip: pass --alertmanager <url> to query live Alertmanager data.\n'));
        }
        return;
      }

      const scored = scoreNoise(rawAlerts);
      const noisy  = scored.filter((a) => a.noiseScore >= threshold);
      const clean  = scored.filter((a) => a.noiseScore <  threshold);

      if (opts.json) {
        console.log(JSON.stringify({ days, threshold, total: scored.length, noisy: noisy.length, alerts: scored }, null, 2));
        return;
      }

      // ── Summary bar ──
      const pct = scored.length ? Math.round((noisy.length / scored.length) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
      const barColor = pct >= 60 ? chalk.red : pct >= 30 ? chalk.yellow : chalk.green;
      console.log(hr());
      console.log(chalk.bold(`\n  Alert noise report — last ${days} days\n`));
      console.log(`  Total alerts  : ${chalk.white(scored.length)}`);
      console.log(`  Noisy (≥${threshold}) : ${noisy.length > 0 ? chalk.red.bold(noisy.length) : chalk.green(noisy.length)}`);
      console.log(`  Actionable    : ${chalk.green(clean.length)}`);
      console.log(`  Noise ratio   : ${barColor(`${bar} ${pct}%`)}\n`);
      console.log(hr());

      // ── Noisy alerts ──
      if (noisy.length > 0) {
        console.log(chalk.red.bold('\n  ● NOISE ALERTS — recommend suppression or tuning\n'));
        noisy.forEach((a, i) => {
          const badge = a.noiseScore >= 80 ? chalk.bgRed.white(' HIGH ') : chalk.bgYellow.black(' MED  ');
          const sil   = a.silenced ? chalk.dim(' [already silenced]') : '';
          console.log(`  ${chalk.dim(`${i + 1}.`)} ${badge} ${chalk.bold.white(a.name)}${sil}`);
          console.log(`     Fires: ${chalk.yellow(a.fires)}  Auto-resolved: ${chalk.dim(a.autoResolved)}  Actioned: ${chalk.dim(a.actioned)}  Score: ${chalk.red(a.noiseScore + '/100')}`);
          if (a.severity) console.log(`     Severity: ${chalk.dim(a.severity)}`);
          console.log('');
        });
        console.log(hr());
      }

      // ── Actionable alerts ──
      if (clean.length > 0) {
        console.log(chalk.green.bold('\n  ● ACTIONABLE ALERTS — keep these\n'));
        clean.forEach((a, i) => {
          console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.green('✓')} ${chalk.white(a.name)}  ${chalk.dim(`Score: ${a.noiseScore}/100  Fires: ${a.fires}`)}`);
        });
        console.log('');
        console.log(hr());
      }

      // ── Suppression commands ──
      if (noisy.length > 0) {
        console.log(chalk.bold('\n  Quick suppression (Alertmanager):\n'));
        noisy.slice(0, 3).forEach((a) => {
          console.log(chalk.dim(`  # Silence ${a.name} for 24h`));
          console.log(chalk.cyan(`  amtool silence add alertname="${a.name}" --duration=24h --comment="noise — review threshold"\n`));
        });
        console.log(hr());
      }

      // ── AI recommendations ──
      if (opts.ai && noisy.length > 0) {
        const ora = (await import('ora')).default;
        const spinner = ora('Getting AI recommendations…').start();
        const context = JSON.stringify({ noisy, clean, days }, null, 2);
        try {
          const result = await analyze(context, SYSTEM_PROMPT, null);
          spinner.stop();
          console.log(chalk.bold('\n  AI recommendations:\n'));
          if (result.fixSteps) {
            result.fixSteps.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
          console.log('');
        } catch {
          spinner.stop();
          console.log(chalk.dim('  AI unavailable — add --ai key via nxs config --setup\n'));
        }
      }

      console.log(chalk.dim(`  Tip: pass --alertmanager <url> to query live data  |  --ai for AI recommendations\n`));
    });
}
