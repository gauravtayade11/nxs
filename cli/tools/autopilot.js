/**
 * nxs autopilot — Self-healing assistant
 * Watches a namespace for pod issues and proposes (or auto-applies) safe fixes.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';

const SYSTEM_PROMPT = `You are a Kubernetes SRE performing automated triage.
Given a pod's current state, logs, and events, recommend the safest fix.

Return a JSON object with exactly this structure:
{
  "tool": "autopilot",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary of the issue>",
  "action": "<one of: restart-pod | bump-memory | fix-image | manual-required>",
  "actionDetail": "<exact kubectl command to apply the fix>",
  "rootCause": "<brief root cause>",
  "safe": <true if auto-applicable without risk, false if manual review needed>
}

Return ONLY valid JSON. No markdown fences.`;

// Safe auto-fix actions — only these run without confirmation
const SAFE_ACTIONS = new Set(['restart-pod']);

function stateColor(state) {
  if (['CrashLoopBackOff', 'OOMKilled', 'Error'].includes(state)) return chalk.red.bold;
  if (['ImagePullBackOff', 'ErrImagePull', 'Pending'].includes(state))  return chalk.yellow;
  return chalk.dim;
}

async function getUnhealthyPods(ns) {
  const r = await run(`kubectl get pods ${ns} -o json 2>/dev/null`);
  if (!r.stdout?.trim()) return [];

  try {
    const items = JSON.parse(r.stdout).items ?? [];
    const unhealthy = [];

    for (const pod of items) {
      const name     = pod.metadata?.name ?? '';
      const podNs    = pod.metadata?.namespace ?? '';
      const statuses = pod.status?.containerStatuses ?? [];

      for (const cs of statuses) {
        const waiting    = cs.state?.waiting;
        const terminated = cs.state?.terminated;
        const restarts   = cs.restartCount ?? 0;

        let issue = null;
        if (waiting?.reason)    issue = waiting.reason;
        else if (terminated?.reason === 'OOMKilled') issue = 'OOMKilled';
        else if (restarts >= 5) issue = 'HighRestarts';

        if (issue) {
          unhealthy.push({
            name, namespace: podNs, issue, restarts,
            container: cs.name,
            image: cs.image,
            memLimit: pod.spec?.containers?.find(c => c.name === cs.name)?.resources?.limits?.memory ?? null,
          });
        }
      }
    }
    return unhealthy;
  } catch { return []; }
}

async function applyFix(action, pod, dryRun) {
  const ns = pod.namespace ? `-n ${pod.namespace}` : '';

  if (action === 'restart-pod') {
    const cmd = `kubectl delete pod ${pod.name} ${ns} --grace-period=0`;
    if (dryRun) return { cmd, applied: false };
    const r = await run(cmd);
    return { cmd, applied: !r.stderr, output: r.stdout || r.stderr };
  }

  if (action === 'bump-memory') {
    // Find the owning deployment
    const depR = await run(`kubectl get pod ${pod.name} ${ns} -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null`);
    const rsName = depR.stdout?.trim();
    let depName = '';
    if (rsName) {
      const depNameR = await run(`kubectl get rs ${rsName} ${ns} -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null`);
      depName = depNameR.stdout?.trim() ?? '';
    }

    // Bump by 25%
    const currentMi = pod.memLimit ? parseInt(pod.memLimit) : 256;
    const newMi     = Math.ceil(currentMi * 1.25);
    const cmd       = depName
      ? `kubectl set resources deployment/${depName} ${ns} --limits=memory=${newMi}Mi`
      : `# Could not find owning deployment for ${pod.name} — patch manually`;
    if (dryRun) return { cmd, applied: false };
    if (!depName) return { cmd, applied: false };
    const r = await run(cmd);
    return { cmd, applied: !r.stderr, output: r.stdout || r.stderr };
  }

  return { cmd: '# No auto-fix available', applied: false };
}

export function registerAutopilot(program) {
  program
    .command('autopilot')
    .description('Watch cluster for issues and auto-apply safe fixes')
    .option('-n, --namespace <ns>', 'Namespace to watch (default: all)')
    .option('--auto', 'Auto-apply safe fixes without confirmation')
    .option('--dry-run', 'Show what would be fixed without applying')
    .option('--once', 'Run once instead of watching')
    .option('--interval <sec>', 'Watch interval in seconds (default: 30)', '30')
    .option('--ai', 'Use AI for triage recommendations')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs autopilot -n production
  $ nxs autopilot -n staging --auto
  $ nxs autopilot --dry-run
  $ nxs autopilot --once --ai`)
    .action(async (opts) => {
      const ns        = opts.namespace ? `-n ${opts.namespace}` : '--all-namespaces';
      const nsLabel   = opts.namespace ?? 'all namespaces';
      const interval  = (Number.parseInt(opts.interval ?? '30', 10) || 30) * 1000;
      const seen      = new Set(); // track already-fixed pods this session

      if (!opts.json) {
        printBanner('Autopilot — self-healing assistant');
        console.log(chalk.dim(`  Watching: ${nsLabel}`));
        if (opts.auto)    console.log(chalk.yellow('  Mode: AUTO — safe fixes applied automatically'));
        if (opts.dryRun)  console.log(chalk.cyan('  Mode: DRY RUN — no changes will be made'));
        if (!opts.auto && !opts.dryRun) console.log(chalk.dim('  Mode: PROMPT — will ask before applying fixes'));
        console.log('');
      }

      const tick = async () => {
        const unhealthy = await getUnhealthyPods(ns);

        if (unhealthy.length === 0) {
          if (!opts.json && opts.once) {
            console.log(chalk.green('  ✓ All pods healthy — nothing to fix.\n'));
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({ timestamp: new Date().toISOString(), unhealthy }, null, 2));
          return;
        }

        console.log(hr());
        console.log(chalk.bold(`\n  ${chalk.red(`⚠ ${unhealthy.length} unhealthy pod(s) detected`)}  ${chalk.dim(new Date().toLocaleTimeString())}\n`));

        for (const pod of unhealthy) {
          const key = `${pod.namespace}/${pod.name}/${pod.issue}`;
          const col = stateColor(pod.issue);

          console.log(`  ${col('●')} ${chalk.white.bold(pod.name)}  ${chalk.dim(pod.namespace)}`);
          console.log(`    Issue   : ${col(pod.issue)}${pod.restarts > 0 ? chalk.dim(`  (${pod.restarts} restarts)`) : ''}`);
          console.log(`    Image   : ${chalk.dim(pod.image ?? 'unknown')}`);
          if (pod.memLimit) console.log(`    Memory  : ${chalk.dim(pod.memLimit + ' limit')}`);

          // Determine recommended action
          let action = 'manual-required';
          if (pod.issue === 'CrashLoopBackOff' || pod.issue === 'HighRestarts') action = 'restart-pod';
          if (pod.issue === 'OOMKilled')        action = 'bump-memory';
          if (pod.issue === 'ImagePullBackOff' || pod.issue === 'ErrImagePull') action = 'fix-image';

          // ── AI triage ──
          if (opts.ai && !seen.has(key)) {
            const logsR = await run(`kubectl logs ${pod.name} -n ${pod.namespace} --tail=30 --previous 2>/dev/null || kubectl logs ${pod.name} -n ${pod.namespace} --tail=30 2>/dev/null`);
            if (logsR.stdout?.trim()) {
              try {
                const aiResult = await analyze(
                  `Pod: ${pod.name}\nIssue: ${pod.issue}\nLogs:\n${logsR.stdout.slice(0, 1000)}`,
                  SYSTEM_PROMPT,
                  () => ({ tool: 'autopilot', severity: 'warning', summary: pod.issue, action, actionDetail: '', rootCause: pod.issue, safe: action === 'restart-pod' })
                );
                if (aiResult.action) action = aiResult.action;
                if (aiResult.rootCause) console.log(`    Root cause: ${chalk.hex('#94a3b8')(aiResult.rootCause.slice(0, 100))}`);
              } catch { /* ignore */ }
            }
          }

          // ── Apply fix ──
          if (action === 'fix-image' || action === 'manual-required') {
            console.log(`    Action  : ${chalk.yellow('Manual review required')}`);
            if (action === 'fix-image') {
              console.log(`    Fix     : ${chalk.cyan(`kubectl describe pod ${pod.name} -n ${pod.namespace}`)}`);
              console.log(chalk.dim(`              Verify image name/tag and registry credentials\n`));
            } else {
              console.log(`    Fix     : ${chalk.cyan(`kubectl describe pod ${pod.name} -n ${pod.namespace}`)}\n`);
            }
            continue;
          }

          const isSafe = SAFE_ACTIONS.has(action);
          console.log(`    Action  : ${isSafe ? chalk.green(action) : chalk.yellow(action)}${isSafe ? '' : chalk.dim(' (requires confirmation)')}`);

          if (opts.dryRun) {
            const { cmd } = await applyFix(action, pod, true);
            console.log(`    Command : ${chalk.cyan(cmd)}`);
            console.log(chalk.dim('    (dry run — not applied)\n'));
            continue;
          }

          if (seen.has(key)) {
            console.log(chalk.dim('    Already handled this session — skipping\n'));
            continue;
          }

          if (opts.auto && isSafe) {
            const { cmd, applied, output } = await applyFix(action, pod, false);
            console.log(`    Command : ${chalk.cyan(cmd)}`);
            if (applied) {
              console.log(chalk.green('    ✓ Applied automatically\n'));
              seen.add(key);
            } else {
              console.log(chalk.yellow(`    ⚠ Could not auto-apply: ${output?.slice(0, 80) ?? 'unknown error'}\n`));
            }
          } else {
            // Prompt
            const { cmd } = await applyFix(action, pod, true);
            console.log(`    Command : ${chalk.cyan(cmd)}`);
            const readline = await import('node:readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer = await new Promise((res) => rl.question(chalk.yellow(`\n    Apply fix? [y/N] `), res));
            rl.close();

            if (answer.toLowerCase() === 'y') {
              const { applied, output } = await applyFix(action, pod, false);
              if (applied) {
                console.log(chalk.green('    ✓ Applied\n'));
                seen.add(key);
              } else {
                console.log(chalk.yellow(`    ⚠ Failed: ${output?.slice(0, 80) ?? 'error'}\n`));
              }
            } else {
              console.log(chalk.dim('    Skipped.\n'));
            }
          }
        }

        if (!opts.once) {
          console.log(chalk.dim(`\n  Next check in ${Math.round(interval / 1000)}s — Ctrl+C to stop\n`));
        }
      };

      // Run immediately, then loop
      await tick();

      if (!opts.once) {
        const timer = setInterval(tick, interval);
        process.on('SIGINT', () => {
          clearInterval(timer);
          console.log(chalk.dim('\n  Autopilot stopped.\n'));
          process.exit(0);
        });
      }
    });
}
