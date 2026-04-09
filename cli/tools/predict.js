/**
 * nxs predict — Predict failures before they happen
 * Analyzes current resource usage vs limits, restart trends,
 * PVC capacity, and node pressure to surface at-risk workloads.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';

const SYSTEM_PROMPT = `You are a Kubernetes SRE predicting imminent failures based on current cluster state.
Given resource usage data (CPU, memory, restarts, PVC capacity, node conditions), identify what is at risk.

Return a JSON object with exactly this structure:
{
  "tool": "predict",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary of cluster risk>",
  "atRisk": [
    { "resource": "<pod/node/pvc name>", "risk": "<what will happen>", "timeframe": "<estimated time>", "recommendation": "<fix>" }
  ],
  "rootCause": "<underlying patterns driving the risk>",
  "fixSteps": "<numbered preventive actions>",
  "commands": "<kubectl commands to verify and fix>"
}

Return ONLY valid JSON. No markdown fences.`;

function pct(used, limit) {
  if (!limit || limit === 0) return null;
  return Math.round((used / limit) * 100);
}

function parseMemory(str) {
  if (!str || str === '0') return 0;
  const m = str.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|m|)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? '';
  if (unit === 'Ki') return n * 1024;
  if (unit === 'Mi') return n * 1024 * 1024;
  if (unit === 'Gi') return n * 1024 * 1024 * 1024;
  return n;
}

function parseCPU(str) {
  if (!str || str === '0') return 0;
  if (str.endsWith('m')) return parseFloat(str) / 1000;
  return parseFloat(str);
}

function riskColor(score) {
  if (score >= 90) return chalk.bgRed.white;
  if (score >= 70) return chalk.red;
  if (score >= 50) return chalk.yellow;
  return chalk.green;
}

export function registerPredict(program) {
  program
    .command('predict')
    .description('Predict pod OOMKills, disk exhaustion, and resource failures before they happen')
    .option('-n, --namespace <ns>', 'Namespace to scan (default: all)')
    .option('--threshold <n>', 'Warn when usage exceeds N% of limit (default: 75)', '75')
    .option('--ai', 'Use AI for deeper risk analysis')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs predict
  $ nxs predict -n production
  $ nxs predict --threshold 80 --ai`)
    .action(async (opts) => {
      const threshold = Number.parseInt(opts.threshold, 10) || 75;
      const ns        = opts.namespace ? `-n ${opts.namespace}` : '--all-namespaces';
      const nsLabel   = opts.namespace ?? 'all namespaces';

      if (!opts.json) {
        printBanner('Predict — failure prediction engine');
        console.log(chalk.dim(`  Scanning: ${nsLabel}  |  Alert threshold: ${threshold}%\n`));
      }

      const ora = (await import('ora')).default;
      const spinner = opts.json ? null : ora('Collecting cluster metrics…').start();

      // Fetch everything in parallel
      const [topPodsR, podsR, nodesR, topNodesR, pvcR] = await Promise.all([
        run(`kubectl top pods ${ns} --no-headers 2>/dev/null`),
        run(`kubectl get pods ${ns} -o json 2>/dev/null`),
        run(`kubectl get nodes -o json 2>/dev/null`),
        run(`kubectl top nodes --no-headers 2>/dev/null`),
        run(`kubectl get pvc ${ns} -o json 2>/dev/null`),
      ]);

      spinner?.stop();

      const risks = [];

      // ── Restart counts — always check, does not need metrics-server ──
      if (podsR.stdout?.trim()) {
        let podSpecs = [];
        try { podSpecs = JSON.parse(podsR.stdout).items ?? []; } catch { /* ignore */ }

        for (const spec of podSpecs) {
          const podName  = spec.metadata?.name ?? '';
          const podNs    = spec.metadata?.namespace ?? '';
          const restarts = spec.status?.containerStatuses?.reduce((s, c) => s + (c.restartCount ?? 0), 0) ?? 0;

          // Flag any pod not in Running/Succeeded phase
          const phase = spec.status?.phase ?? '';
          const containerStatuses = spec.status?.containerStatuses ?? [];
          for (const cs of containerStatuses) {
            const reason = cs.state?.waiting?.reason ?? cs.state?.terminated?.reason ?? '';
            if (['CrashLoopBackOff', 'OOMKilled', 'Error', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerError'].includes(reason)) {
              risks.push({
                type: 'pod-state', severity: reason === 'OOMKilled' || reason === 'CrashLoopBackOff' ? 'critical' : 'warning',
                resource: `pod/${podName}`, namespace: podNs,
                metric: reason,
                detail: cs.state?.waiting?.message ?? reason,
                risk: reason === 'OOMKilled' ? 'Will OOMKill again without memory increase' : `Container stuck in ${reason}`,
                timeframe: 'now',
                score: reason === 'OOMKilled' || reason === 'CrashLoopBackOff' ? 95 : 75,
                recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
              });
            }
          }

          if (restarts >= 5) {
            risks.push({
              type: 'pod-restarts', severity: restarts >= 20 ? 'critical' : 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `${restarts} restarts`,
              detail: `High restart count — recurring crash`,
              risk: 'CrashLoopBackOff imminent',
              timeframe: 'recurring',
              score: Math.min(restarts * 2, 100),
              recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
            });
          }
        }
      }

      // ── Pod resource usage vs limits (requires metrics-server) ──
      if (topPodsR.stdout?.trim() && podsR.stdout?.trim()) {
        let podSpecs = [];
        try { podSpecs = JSON.parse(podsR.stdout).items ?? []; } catch { /* ignore */ }

        const topLines = topPodsR.stdout.trim().split('\n');
        for (const line of topLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const [podName, cpuStr, memStr] = parts;

          const spec = podSpecs.find((p) => p.metadata?.name === podName);
          if (!spec) continue;

          const containers = spec.spec?.containers ?? [];
          let memLimit = 0, cpuLimit = 0;
          for (const c of containers) {
            memLimit += parseMemory(c.resources?.limits?.memory ?? '0');
            cpuLimit += parseCPU(c.resources?.limits?.cpu       ?? '0');
          }

          const memUsed = parseMemory(memStr);
          const cpuUsed = parseCPU(cpuStr);
          const memPct  = pct(memUsed, memLimit);
          const cpuPct  = pct(cpuUsed, cpuLimit);
          const podNs   = spec.metadata?.namespace ?? '';

          if (memPct !== null && memPct >= threshold) {
            risks.push({
              type: 'pod-memory', severity: memPct >= 90 ? 'critical' : 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `Memory ${memPct}% of limit`,
              detail: `Using ${memStr} of ${(memLimit / (1024 * 1024)).toFixed(0)}Mi limit`,
              risk: 'OOMKilled',
              timeframe: memPct >= 95 ? 'imminent' : memPct >= 90 ? '< 1h' : '< 24h',
              score: memPct,
              recommendation: `kubectl set resources deploy/<name> -n ${podNs} --limits=memory=<higher>`,
            });
          }

          if (cpuPct !== null && cpuPct >= threshold) {
            risks.push({
              type: 'pod-cpu', severity: 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `CPU ${cpuPct}% of limit`,
              detail: `Using ${cpuStr} of ${(cpuLimit * 1000).toFixed(0)}m limit`,
              risk: 'CPU throttling / slow responses',
              timeframe: 'ongoing',
              score: cpuPct,
              recommendation: `Increase CPU limit or add HPA for auto-scaling`,
            });
          }
        }
      }

      // ── Node pressure ──
      if (nodesR.stdout?.trim()) {
        try {
          const nodeList = JSON.parse(nodesR.stdout).items ?? [];
          for (const node of nodeList) {
            const conditions = node.status?.conditions ?? [];
            for (const cond of conditions) {
              if (['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(cond.type) && cond.status === 'True') {
                risks.push({
                  type: 'node-pressure', severity: 'critical',
                  resource: `node/${node.metadata?.name}`,
                  namespace: 'cluster',
                  metric: cond.type,
                  detail: cond.message ?? cond.type,
                  risk: `Node evictions — pods will be killed`,
                  timeframe: 'ongoing',
                  score: 95,
                  recommendation: `kubectl describe node ${node.metadata?.name}`,
                });
              }
            }
          }
        } catch { /* ignore */ }
      }

      // ── PVC capacity ──
      if (pvcR.stdout?.trim()) {
        try {
          const pvcList = JSON.parse(pvcR.stdout).items ?? [];
          for (const pvc of pvcList) {
            if (pvc.status?.phase !== 'Bound') {
              risks.push({
                type: 'pvc-unbound', severity: 'warning',
                resource: `pvc/${pvc.metadata?.name}`,
                namespace: pvc.metadata?.namespace ?? '',
                metric: `Phase: ${pvc.status?.phase}`,
                detail: 'PVC not bound — pods requiring this volume will be Pending',
                risk: 'Pod stuck in Pending',
                timeframe: 'now',
                score: 80,
                recommendation: `kubectl describe pvc ${pvc.metadata?.name} -n ${pvc.metadata?.namespace}`,
              });
            }
          }
        } catch { /* ignore */ }
      }

      risks.sort((a, b) => b.score - a.score);

      if (opts.json) {
        console.log(JSON.stringify({ namespace: opts.namespace ?? 'all', threshold, total: risks.length, risks }, null, 2));
        return;
      }

      // ── Summary ──
      const critical = risks.filter((r) => r.severity === 'critical');
      const warning  = risks.filter((r) => r.severity === 'warning');

      console.log(hr());
      console.log(chalk.bold(`\n  Prediction report — ${nsLabel}\n`));
      console.log(`  At-risk resources : ${risks.length > 0 ? chalk.red.bold(risks.length) : chalk.green('0')}`);
      console.log(`  Critical          : ${critical.length > 0 ? chalk.red.bold(critical.length) : chalk.dim('0')}`);
      console.log(`  Warning           : ${warning.length  > 0 ? chalk.yellow(warning.length)   : chalk.dim('0')}`);
      console.log('');
      console.log(hr());

      if (risks.length === 0) {
        console.log(chalk.green('\n  ✓ No imminent failures detected.\n'));
        console.log(chalk.dim(`  All resources are below ${threshold}% of their limits.\n`));
        console.log(hr() + '\n');
        return;
      }

      // ── Risk list ──
      risks.forEach((r, i) => {
        const badge = riskColor(r.score)(` ${r.score}% `);
        const sev   = r.severity === 'critical' ? chalk.red.bold('CRITICAL') : chalk.yellow('WARNING ');
        console.log(`\n  ${chalk.dim(`${i + 1}.`)} ${sev}  ${badge}  ${chalk.white.bold(r.resource)}  ${chalk.dim(r.namespace)}`);
        console.log(`     ${chalk.hex('#94a3b8')(r.metric)}  —  ${chalk.dim(r.detail)}`);
        console.log(`     Risk: ${chalk.yellow(r.risk)}  |  Timeframe: ${chalk.dim(r.timeframe)}`);
        console.log(`     Fix:  ${chalk.cyan(r.recommendation)}`);
      });

      console.log('\n' + hr());

      // ── Quick fixes ──
      const oomRisks = risks.filter((r) => r.type === 'pod-memory').slice(0, 3);
      if (oomRisks.length > 0) {
        console.log(chalk.bold('\n  Quick actions for high memory pods:\n'));
        oomRisks.forEach((r) => {
          const name = r.resource.replace('pod/', '');
          console.log(chalk.dim(`  # Check ${name} memory trend`));
          console.log(chalk.cyan(`  kubectl top pod ${name} -n ${r.namespace}\n`));
        });
      }

      // ── AI deep analysis ──
      if (opts.ai && risks.length > 0) {
        const spinner2 = ora('AI predicting failure timeline…').start();
        const context  = JSON.stringify(risks.slice(0, 15), null, 2);
        try {
          const result = await analyze(context, SYSTEM_PROMPT, null);
          spinner2.stop();
          console.log(chalk.bold('\n  AI prediction:\n'));
          if (result.summary) console.log(`  ${chalk.hex('#94a3b8')(result.summary)}\n`);
          if (result.fixSteps) {
            console.log(chalk.bold('  Preventive actions:\n'));
            result.fixSteps.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
        } catch {
          spinner2.stop();
        }
      }

      console.log('\n' + hr() + '\n');
    });
}
