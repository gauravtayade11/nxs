/**
 * nxs blame — Correlate what changed right before a breakage
 * Combines git log + kubectl events + deploy history into a timeline,
 * then uses AI to identify the likely culprit.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { loadHistory } from '../core/config.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';
import { checkDeps, warnMissingDeps } from '../core/deps.js';

const SYSTEM_PROMPT = `You are an SRE performing root cause analysis on a production incident.
You have been given a timeline of events: git commits, Kubernetes events, deployment rollouts, and past analyses.

Correlate the events and identify the most likely root cause of the breakage.

Return a JSON object with exactly this structure:
{
  "tool": "blame",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary of what likely caused the issue>",
  "likelyCulprit": "<the single most likely cause: a commit hash, a deploy, or an event>",
  "timeline": "<key events in chronological order, one per line>",
  "rootCause": "<detailed explanation of causation chain>",
  "fixSteps": "<steps to verify and fix>",
  "commands": "<git/kubectl commands to confirm and rollback if needed>"
}

Return ONLY valid JSON. No markdown fences.`;

function parseDuration(since) {
  // Parse "2h ago", "30m", "1d", "2h" etc.
  const m = since.match(/^(\d+)\s*(s|m|h|d)/i);
  if (!m) return 60 * 60 * 1000; // default 1h
  const n = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (ms[unit] ?? 3600000);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function registerBlame(program) {
  program
    .command('blame')
    .description('Correlate what changed before a breakage — git + k8s + deploy timeline')
    .option('--since <duration>', 'How far back to look (e.g. 1h, 30m, 2h)', '1h')
    .option('-n, --namespace <ns>', 'Kubernetes namespace to scan events')
    .option('--repo <path>', 'Path to the application git repo (default: current directory)')
    .option('--no-git', 'Skip git log')
    .option('--no-k8s', 'Skip kubectl events')
    .option('--no-ai', 'Skip AI analysis — just print timeline')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs blame
  $ nxs blame --since 2h -n production
  $ nxs blame --since 30m --repo /path/to/your-app -n production
  $ nxs blame --no-ai --no-git   # k8s events only`)
    .action(async (opts) => {
      if (!opts.noGit) await warnMissingDeps('git');
      if (!await checkDeps('kubectl')) { process.exit(1); }
      const windowMs  = parseDuration(opts.since ?? '1h');
      const since     = new Date(Date.now() - windowMs);
      const sinceISO  = since.toISOString();
      const ns        = opts.namespace ? `-n ${opts.namespace}` : '--all-namespaces';

      if (!opts.json) {
        printBanner('Blame — incident timeline correlator');
        console.log(chalk.dim(`  Window: last ${opts.since ?? '1h'}  (since ${since.toLocaleTimeString()})\n`));
      }

      const timeline = [];
      const ora = (await import('ora')).default;

      // ── Git log ──
      if (opts.git !== false) {
        const spinner = opts.json ? null : ora('Fetching git log…').start();
        const repoFlag = opts.repo ? `-C ${opts.repo}` : '';
        // Use ISO timestamp so we can sort commits alongside k8s events
        const gitR = await run(`git ${repoFlag} log --since="${sinceISO}" --format="%H %aI %s" --no-merges 2>/dev/null`);
        spinner?.stop();
        if (gitR.stdout?.trim()) {
          gitR.stdout.trim().split('\n').forEach((line) => {
            const parts = line.split(' ');
            const hash  = parts[0];
            const ts    = parts[1] ?? '';
            const msg   = parts.slice(2).join(' ');
            timeline.push({ type: 'git', icon: '⊙', label: 'commit', hash, message: msg, timestamp: ts });
          });
        }
      }

      // ── kubectl events ──
      if (opts.k8s !== false) {
        const spinner = opts.json ? null : ora('Fetching Kubernetes events…').start();
        const evR = await run(`kubectl get events ${ns} --sort-by='.lastTimestamp' -o json 2>/dev/null`);
        spinner?.stop();
        if (evR.stdout?.trim()) {
          try {
            const evList = JSON.parse(evR.stdout);
            for (const ev of evList.items ?? []) {
              const ts = ev.lastTimestamp ?? ev.eventTime ?? '';
              if (ts && new Date(ts) >= since) {
                const sev  = ev.type === 'Warning' ? 'warning' : 'info';
                const name = ev.involvedObject?.name ?? '';
                timeline.push({
                  type: 'k8s-event',
                  icon: ev.type === 'Warning' ? '⚠' : '●',
                  label: `k8s ${ev.reason ?? 'event'}`,
                  severity: sev,
                  resource: `${ev.involvedObject?.kind ?? ''}/${name}`,
                  namespace: ev.metadata?.namespace ?? '',
                  message: ev.message ?? '',
                  timestamp: ts,
                });
              }
            }
          } catch { /* ignore parse error */ }
        }

        // ── Deployment rollout history ──
        const depR = await run(`kubectl get deployments ${ns} -o jsonpath='{.items[*].metadata.name}' 2>/dev/null`);
        if (depR.stdout?.trim()) {
          const deployments = depR.stdout.trim().split(/\s+/).filter(Boolean).slice(0, 10);
          for (const dep of deployments) {
            const nsFlag = opts.namespace ? `-n ${opts.namespace}` : '';
            const histR  = await run(`kubectl rollout history deployment/${dep} ${nsFlag} 2>/dev/null`);
            if (histR.stdout?.trim()) {
              const lines = histR.stdout.trim().split('\n').slice(2); // skip header
              for (const line of lines) {
                const [rev, ...changeCause] = line.trim().split(/\s+/);
                if (rev && changeCause.join(' ') !== '<none>') {
                  timeline.push({
                    type: 'rollout',
                    icon: '⟳',
                    label: 'deploy',
                    deployment: dep,
                    revision: rev,
                    message: changeCause.join(' ') || `revision ${rev}`,
                  });
                }
              }
            }
          }
        }
      }

      // ── nxs history entries in window ──
      const nxsEntries = loadHistory().filter((e) => new Date(e.timestamp).getTime() >= since.getTime());
      for (const e of nxsEntries) {
        timeline.push({
          type: 'nxs-analysis',
          icon: '◆',
          label: `nxs ${e.toolModule ?? 'analysis'}`,
          severity: e.severity,
          message: e.summary ?? '',
          timestamp: e.timestamp,
        });
      }

      // Sort by timestamp where available
      timeline.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      if (opts.json) {
        console.log(JSON.stringify({ since: sinceISO, window: opts.since, events: timeline.length, timeline }, null, 2));
        return;
      }

      if (timeline.length === 0) {
        console.log(chalk.dim(`  No events found in the last ${opts.since ?? '1h'}.\n`));
        console.log(chalk.dim('  Try: nxs blame --since 6h\n'));
        return;
      }

      // ── Print timeline ──
      console.log(hr());
      console.log(chalk.bold(`\n  Timeline — ${timeline.length} event(s) in last ${opts.since ?? '1h'}\n`));

      const typeColors = {
        'git':          chalk.cyan,
        'k8s-event':    chalk.yellow,
        'rollout':      chalk.blue,
        'nxs-analysis': chalk.magenta,
      };

      for (const ev of timeline) {
        const col  = typeColors[ev.type] ?? chalk.white;
        const ts   = ev.timestamp ? chalk.dim(fmtTime(ev.timestamp)) : '';
        const icon = ev.severity === 'warning' || ev.severity === 'critical' ? chalk.red(ev.icon) : col(ev.icon);
        const label = col(`[${ev.label}]`).padEnd(22);
        const msg  = ev.message?.slice(0, 80) ?? '';
        const extra = ev.hash ? chalk.dim(ev.hash + ' ') : ev.resource ? chalk.dim(ev.resource + ' ') : '';
        console.log(`  ${ts.padEnd(10)}  ${icon} ${label}  ${extra}${chalk.hex('#94a3b8')(msg)}`);
      }

      console.log('\n' + hr());

      // ── AI analysis ──
      if (opts.ai !== false) {
        const spinner = ora('AI correlating timeline…').start();
        const context = [
          `Analysis window: last ${opts.since ?? '1h'} (since ${since.toISOString()})`,
          `IMPORTANT: Only correlate events that fall WITHIN this time window. Git commits outside the window are not related to the incident.`,
          '',
          ...timeline.map((e) =>
            `[${e.type}] ${e.timestamp ? new Date(e.timestamp).toISOString() : 'no-timestamp'} ${e.label}: ${e.message ?? ''} ${e.hash ?? ''} ${e.resource ?? ''}`
          ),
        ].join('\n');

        try {
          const result = await analyze(context, SYSTEM_PROMPT, (_text) => ({
            tool: 'blame', severity: 'warning',
            summary: 'Timeline analyzed in demo mode.',
            likelyCulprit: timeline.find((e) => e.type === 'git')?.message ?? 'unknown',
            timeline: context.slice(0, 300),
            rootCause: 'Could not determine root cause without AI key.',
            fixSteps: '1. Review git commits in the window.\n2. Check kubectl rollout history.\n3. Run: nxs config --setup to add AI key.',
            commands: 'git log --since="1h ago" --oneline\nkubectl get events --sort-by=.lastTimestamp',
          }));

          spinner.stop();
          console.log(chalk.bold('\n  AI verdict:\n'));
          console.log(`  ${chalk.yellow('Likely culprit:')} ${chalk.white.bold(result.likelyCulprit ?? 'unknown')}\n`);
          console.log(`  ${chalk.bold('Summary:')} ${chalk.hex('#94a3b8')(result.summary)}\n`);
          if (result.rootCause) {
            console.log(chalk.bold('  Root cause:\n'));
            result.rootCause.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
          if (result.fixSteps) {
            console.log(chalk.bold('\n  Fix steps:\n'));
            result.fixSteps.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
          if (result.commands) {
            console.log(chalk.bold('\n  Commands:\n'));
            result.commands.split('\n').forEach((l) => console.log(`  ${chalk.cyan(l)}`));
          }
        } catch {
          spinner.stop();
          console.log(chalk.dim('  AI unavailable.\n'));
        }
        console.log('\n' + hr() + '\n');
      }
    });
}
