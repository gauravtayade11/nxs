/**
 * nxs predict — Predict failures before they happen
 * Analyzes current resource usage vs limits, restart trends,
 * PVC capacity, and node pressure to surface at-risk workloads.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';
import { checkDeps } from '../core/deps.js';

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
  const m = str.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|m)?$/);
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  const unit = m[2] ?? '';
  if (unit === 'Ki') return n * 1024;
  if (unit === 'Mi') return n * 1024 * 1024;
  if (unit === 'Gi') return n * 1024 * 1024 * 1024;
  return n;
}

function parseCPU(str) {
  if (!str || str === '0') return 0;
  if (str.endsWith('m')) return Number.parseFloat(str) / 1000;
  return Number.parseFloat(str);
}

function bytesToMi(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

// ── Group flat risks into per-pod summaries ──────────────────────────────────
function buildPodMap(risks) {
  const map = {};

  for (const r of risks) {
    const key = `${r.resource}::${r.namespace}`;
    if (!map[key]) {
      map[key] = {
        resource: r.resource,
        namespace: r.namespace,
        severity: r.severity,
        score: r.score,
        findings: [],
        primaryRisk: r.risk,
        // raw flags for recommendations generation
        _hasOOMKilled: false,
        _hasCrashLoop: false,
        _hasImagePull: false,
        _hasPending: false,
        _memPct: null,
        _memLimitMi: null,
        _memUsedMi: null,
        _requestMi: null,
        _limitMi: null,
        _hpaExists: r._hpaExists ?? false,
        _restarts: 0,
      };
    }
    const entry = map[key];

    // Escalate severity
    if (r.severity === 'critical') entry.severity = 'critical';
    if (r.score > entry.score) {
      entry.score = r.score;
      entry.primaryRisk = r.risk;
    }

    // Merge raw flags
    if (r._hasOOMKilled)  entry._hasOOMKilled  = true;
    if (r._hasCrashLoop)  entry._hasCrashLoop  = true;
    if (r._hasImagePull)  entry._hasImagePull  = true;
    if (r._hasPending)    entry._hasPending    = true;
    if (r._hpaExists)     entry._hpaExists     = true;
    if (r._restarts > entry._restarts) entry._restarts = r._restarts;
    if (r._memPct    != null) entry._memPct    = r._memPct;
    if (r._memLimitMi != null) entry._memLimitMi = r._memLimitMi;
    if (r._memUsedMi  != null) entry._memUsedMi  = r._memUsedMi;
    if (r._requestMi  != null) entry._requestMi  = r._requestMi;
    if (r._limitMi    != null) entry._limitMi    = r._limitMi;

    // Add finding text (deduplicate)
    const text = r._findingText ?? r.detail;
    if (text && !entry.findings.includes(text)) entry.findings.push(text);
  }

  return map;
}

// ── Generate per-pod recommendations + commands ──────────────────────────────
function generateRecsAndCmds(podName, ns, entry) {
  const recs = [];
  const cmds = [];

  if (entry._hasOOMKilled || (entry._memPct !== null && entry._memPct >= 90)) {
    const baseMi = entry._memLimitMi ?? entry._limitMi ?? 128;
    const newMi  = Math.max(Math.round(baseMi * 1.5 / 64) * 64, baseMi + 64);
    recs.push(`Increase memory limit to at least ${newMi}Mi immediately`);
    cmds.push(`kubectl set resources pod/${podName} --limits=memory=${newMi}Mi -n ${ns}`);
  }

  if (entry._requestMi != null && entry._limitMi != null && entry._limitMi > entry._requestMi * 1.5) {
    recs.push(`Set request equal to limit for predictable scheduling`);
    const targetMi = entry._limitMi;
    if (!cmds.some(c => c.includes('requests'))) {
      cmds.push(`kubectl set resources pod/${podName} --requests=memory=${targetMi}Mi --limits=memory=${targetMi}Mi -n ${ns}`);
    }
  }

  if (!entry._hpaExists && (entry._hasOOMKilled || (entry._memPct !== null && entry._memPct >= 75))) {
    recs.push(`Add HPA if traffic is variable`);
  }

  if (entry._hasCrashLoop || entry._restarts >= 5) {
    recs.push(`Check application logs for the crash cause`);
    cmds.push(`kubectl logs ${podName} -n ${ns} --previous`);
  }

  if (entry._hasImagePull) {
    recs.push(`Verify image name and tag are correct`, `Add imagePullSecrets if using a private registry`);
    cmds.push(`kubectl describe pod ${podName} -n ${ns}`);
  }

  if (entry._hasPending) {
    recs.push(`Check node resources and taints`);
    cmds.push(`kubectl describe pod ${podName} -n ${ns}`);
  }

  // Fallback
  if (recs.length === 0) {
    recs.push(`Inspect pod for issues`);
    cmds.push(`kubectl describe pod ${podName} -n ${ns}`);
  }

  return { recs, cmds };
}

// ── Render in article style ──────────────────────────────────────────────────
function renderArticleStyle(podMap, nsLabel, threshold) {
  const pods = Object.values(podMap).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.score - a.score;
  });

  if (pods.length === 0) {
    console.log(chalk.green('\n  ✓ No imminent failures detected.\n'));
    console.log(chalk.dim(`  All resources are below ${threshold}% of their limits.\n`));
    console.log(hr() + '\n');
    return;
  }

  const divider = '  ' + chalk.dim('─'.repeat(54));

  // ── Header ──
  console.log('');
  const header = chalk.bold(`◈  PREDICT — Failure Prediction · namespace: ${nsLabel}`);
  console.log(`  ${header}`);
  console.log(divider);

  // ── Per-pod blocks ──
  for (const pod of pods) {
    const podName = pod.resource.replace(/^pod\//, '');
    const icon    = pod.severity === 'critical' ? chalk.red('✗') : chalk.yellow('⚠');
    const badge   = pod.severity === 'critical'
      ? chalk.bgRed.white.bold(' CRITICAL ')
      : chalk.bgYellow.black.bold(' WARNING  ');

    // Right-align the badge at col ~54
    const gap = Math.max(1, 44 - podName.length);
    console.log(`\n  ${icon}  ${chalk.white.bold(podName)}${' '.repeat(gap)}${badge}`);

    for (const f of pod.findings) {
      console.log(`     ${chalk.hex('#94a3b8')(f)}`);
    }
    console.log(`     ${chalk.dim('Risk:')} ${chalk.yellow(pod.primaryRisk)}`);
  }

  // ── Recommendations ──
  console.log('\n' + divider);
  console.log('');
  console.log(`  ${chalk.bold('RECOMMENDATIONS')}`);
  console.log('');

  for (const pod of pods) {
    const podName = pod.resource.replace(/^pod\//, '');
    const { recs, cmds } = generateRecsAndCmds(podName, pod.namespace, pod);
    pod._cmds = cmds;

    console.log(`  ${chalk.white.bold(podName)}`);
    recs.forEach((rec, i) => {
      const num = chalk.dim(`${i + 1}.`);
      console.log(`    ${num} ${chalk.hex('#94a3b8')(rec)}`);
    });
    console.log('');
  }

  // ── Commands ready to copy ──
  const allCmds = [...new Set(pods.flatMap(p => p._cmds ?? []))];
  if (allCmds.length > 0) {
    console.log(divider);
    console.log('');
    console.log(`  ${chalk.bold('COMMANDS READY TO COPY')}`);
    console.log('');
    allCmds.forEach(cmd => console.log(`    ${chalk.cyan(cmd)}`));
    console.log('');
  }

  console.log(divider + '\n');
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
      if (!await checkDeps('kubectl')) { process.exit(1); }
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
      const [topPodsR, podsR, nodesR, , pvcR, hpaR] = await Promise.all([
        run(`kubectl top pods ${ns} --no-headers 2>/dev/null`),
        run(`kubectl get pods ${ns} -o json 2>/dev/null`),
        run(`kubectl get nodes -o json 2>/dev/null`),
        run(`kubectl top nodes --no-headers 2>/dev/null`),
        run(`kubectl get pvc ${ns} -o json 2>/dev/null`),
        run(`kubectl get hpa ${ns} -o json 2>/dev/null`),
      ]);

      spinner?.stop();

      // Build set of pod names covered by an HPA
      const hpaPods = new Set();
      if (hpaR.stdout?.trim()) {
        try {
          const hpaList = JSON.parse(hpaR.stdout).items ?? [];
          for (const h of hpaList) {
            hpaPods.add(h.spec?.scaleTargetRef?.name ?? '');
          }
        } catch { /* ignore */ }
      }

      const risks = [];

      // ── Pod state + restarts ─────────────────────────────────────────────
      let podSpecs = [];
      if (podsR.stdout?.trim()) {
        try { podSpecs = JSON.parse(podsR.stdout).items ?? []; } catch { /* ignore */ }

        for (const spec of podSpecs) {
          const podName  = spec.metadata?.name ?? '';
          const podNs    = spec.metadata?.namespace ?? '';
          const restarts = spec.status?.containerStatuses?.reduce((s, c) => s + (c.restartCount ?? 0), 0) ?? 0;
          const hpaExists = hpaPods.has(podName);

          // ── Static request/limit ratio analysis ──
          const containers = spec.spec?.containers ?? [];
          for (const c of containers) {
            const reqMem   = parseMemory(c.resources?.requests?.memory ?? '0');
            const limMem   = parseMemory(c.resources?.limits?.memory   ?? '0');
            const reqMi    = reqMem ? bytesToMi(reqMem) : null;
            const limMi    = limMem ? bytesToMi(limMem) : null;

            if (reqMi != null && limMi != null && limMi > 0 && limMi > reqMi * 2) {
              risks.push({
                type: 'pod-ratio', severity: 'warning',
                resource: `pod/${podName}`, namespace: podNs,
                metric: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
                detail: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
                risk: 'Memory spike will OOMKill this container',
                timeframe: 'under load',
                score: 60,
                recommendation: `kubectl set resources pod/${podName} --requests=memory=${limMi}Mi --limits=memory=${limMi}Mi -n ${podNs}`,
                _findingText: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
                _requestMi: reqMi, _limitMi: limMi,
                _hpaExists: hpaExists,
              });
              if (!hpaExists) {
                risks.push({
                  type: 'pod-no-hpa', severity: 'warning',
                  resource: `pod/${podName}`, namespace: podNs,
                  metric: 'No horizontal autoscaling configured',
                  detail: 'No horizontal autoscaling configured',
                  risk: 'Memory spike will OOMKill this container',
                  timeframe: 'under load', score: 55,
                  recommendation: '',
                  _findingText: 'No horizontal autoscaling configured',
                  _hpaExists: false,
                });
              }
            }
          }

          // ── Container state checks ──
          const containerStatuses = spec.status?.containerStatuses ?? [];
          for (const cs of containerStatuses) {
            const reason = cs.state?.waiting?.reason ?? cs.state?.terminated?.reason ?? '';
            const lastReason = cs.lastState?.terminated?.reason ?? '';

            if (['CrashLoopBackOff', 'OOMKilled', 'Error', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerError'].includes(reason)) {
              const isCritical = reason === 'OOMKilled' || reason === 'CrashLoopBackOff';
              const isOOM      = reason === 'OOMKilled' || lastReason === 'OOMKilled';
              const isCrash    = reason === 'CrashLoopBackOff';
              const isImgPull  = reason === 'ImagePullBackOff' || reason === 'ErrImagePull';

              // Build the finding lines
              const lines = [];
              const restartSuffix = restarts > 0 ? ` (${restarts} restarts)` : '';
              lines.push(`Status: ${reason}${restartSuffix}`);
              if (isOOM || lastReason === 'OOMKilled') lines.push(`Last termination: OOMKilled`);

              // Memory numbers from spec
              const containers2 = spec.spec?.containers ?? [];
              for (const c of containers2) {
                const limMem = parseMemory(c.resources?.limits?.memory ?? '0');
                if (limMem > 0 && isOOM) {
                  lines.push(`Memory limit: ${bytesToMi(limMem)}Mi — container exceeded limit`);
                }
              }

              risks.push({
                type: 'pod-state', severity: isCritical ? 'critical' : 'warning',
                resource: `pod/${podName}`, namespace: podNs,
                metric: reason,
                detail: lines[0],
                risk: isOOM ? 'Will OOMKill again without memory increase' : `Container stuck in ${reason}`,
                timeframe: 'now',
                score: isCritical ? 95 : 75,
                recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
                _findingText: null, // handled by lines below
                _hasOOMKilled: isOOM,
                _hasCrashLoop: isCrash,
                _hasImagePull: isImgPull,
                _restarts: restarts,
                _hpaExists: hpaExists,
                _extraLines: lines.slice(1),
              });

              // Add extra finding lines as separate entries (for grouping)
              for (const line of lines.slice(1)) {
                risks.push({
                  type: 'pod-state-detail', severity: isCritical ? 'critical' : 'warning',
                  resource: `pod/${podName}`, namespace: podNs,
                  metric: line, detail: line, risk: '',
                  timeframe: 'now', score: isCritical ? 94 : 74,
                  recommendation: '',
                  _findingText: line,
                  _hpaExists: hpaExists,
                });
              }
            }
          }

          // ── High restart count ──
          if (restarts >= 5) {
            risks.push({
              type: 'pod-restarts', severity: restarts >= 20 ? 'critical' : 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `${restarts} restarts`,
              detail: `${restarts} restarts — recurring crash`,
              risk: 'CrashLoopBackOff imminent',
              timeframe: 'recurring',
              score: Math.min(restarts * 2, 100),
              recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
              _findingText: `${restarts} restarts — recurring crash`,
              _restarts: restarts,
              _hasCrashLoop: restarts >= 20,
              _hpaExists: hpaExists,
            });
          }

          // ── Pending pod (only if container statuses are absent — truly unscheduled) ──
          const hasContainerState = (spec.status?.containerStatuses?.length ?? 0) > 0;
          if (spec.status?.phase === 'Pending' && !hasContainerState) {
            risks.push({
              type: 'pod-pending', severity: 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: 'Pending',
              detail: 'Pod stuck in Pending — cannot be scheduled',
              risk: 'Pod never starts — scheduling failure',
              timeframe: 'now', score: 70,
              recommendation: `kubectl describe pod ${podName} -n ${podNs}`,
              _findingText: 'Pod stuck in Pending — cannot be scheduled',
              _hasPending: true,
              _hpaExists: hpaExists,
            });
          }
        }
      }

      // ── Pod resource usage vs limits (requires metrics-server) ───────────
      if (topPodsR.stdout?.trim() && podSpecs.length > 0) {
        const topLines = topPodsR.stdout.trim().split('\n');
        for (const line of topLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const [podName, cpuStr, memStr] = parts;

          const spec = podSpecs.find((p) => p.metadata?.name === podName);
          if (!spec) continue;

          const containers = spec.spec?.containers ?? [];
          let memLimit = 0, cpuLimit = 0, memRequest = 0;
          for (const c of containers) {
            memLimit   += parseMemory(c.resources?.limits?.memory   ?? '0');
            cpuLimit   += parseCPU(c.resources?.limits?.cpu         ?? '0');
            memRequest += parseMemory(c.resources?.requests?.memory ?? '0');
          }

          const memUsed = parseMemory(memStr);
          const cpuUsed = parseCPU(cpuStr);
          const memPct  = pct(memUsed, memLimit);
          const cpuPct  = pct(cpuUsed, cpuLimit);
          const podNs   = spec.metadata?.namespace ?? '';
          const hpaExists = hpaPods.has(podName);

          if (memPct !== null && memPct >= threshold) {
            const usedMi  = bytesToMi(memUsed);
            const limitMi = bytesToMi(memLimit);
            const reqMi   = memRequest ? bytesToMi(memRequest) : null;
            let tf = '< 24h';
            if (memPct >= 95) tf = 'imminent';
            else if (memPct >= 90) tf = '< 1h';

            risks.push({
              type: 'pod-memory', severity: memPct >= 90 ? 'critical' : 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `Memory ${memPct}% of limit`,
              detail: `Memory: ${usedMi}Mi of ${limitMi}Mi limit (${memPct}%)`,
              risk: 'OOMKilled',
              timeframe: tf, score: memPct,
              recommendation: `kubectl set resources pod/${podName} --limits=memory=${Math.round(limitMi * 1.5 / 64) * 64}Mi -n ${podNs}`,
              _findingText: `Memory: ${usedMi}Mi of ${limitMi}Mi limit (${memPct}%)`,
              _memPct: memPct, _memLimitMi: limitMi, _memUsedMi: usedMi,
              _requestMi: reqMi, _limitMi: limitMi,
              _hasOOMKilled: false,
              _hpaExists: hpaExists,
            });
          }

          if (cpuPct !== null && cpuPct >= threshold) {
            risks.push({
              type: 'pod-cpu', severity: 'warning',
              resource: `pod/${podName}`, namespace: podNs,
              metric: `CPU ${cpuPct}% of limit`,
              detail: `CPU: ${cpuStr} of ${(cpuLimit * 1000).toFixed(0)}m limit (${cpuPct}%)`,
              risk: 'CPU throttling / slow responses',
              timeframe: 'ongoing', score: cpuPct,
              recommendation: `Increase CPU limit or add HPA for auto-scaling`,
              _findingText: `CPU: ${cpuStr} of ${(cpuLimit * 1000).toFixed(0)}m limit (${cpuPct}%)`,
              _hpaExists: hpaExists,
            });
          }
        }
      }

      // ── Node pressure ────────────────────────────────────────────────────
      if (nodesR.stdout?.trim()) {
        try {
          const nodeList = JSON.parse(nodesR.stdout).items ?? [];
          for (const node of nodeList) {
            for (const cond of (node.status?.conditions ?? [])) {
              if (['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(cond.type) && cond.status === 'True') {
                risks.push({
                  type: 'node-pressure', severity: 'critical',
                  resource: `node/${node.metadata?.name}`,
                  namespace: 'cluster',
                  metric: cond.type,
                  detail: cond.message ?? cond.type,
                  risk: 'Node evictions — pods will be killed',
                  timeframe: 'ongoing', score: 95,
                  recommendation: `kubectl describe node ${node.metadata?.name}`,
                  _findingText: cond.message ?? cond.type,
                });
              }
            }
          }
        } catch { /* ignore */ }
      }

      // ── PVC capacity ─────────────────────────────────────────────────────
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
                detail: `PVC ${pvc.status?.phase} — pods requiring this volume will be Pending`,
                risk: 'Pod stuck in Pending',
                timeframe: 'now', score: 80,
                recommendation: `kubectl describe pvc ${pvc.metadata?.name} -n ${pvc.metadata?.namespace}`,
                _findingText: `PVC ${pvc.status?.phase} — pods requiring this volume will be Pending`,
              });
            }
          }
        } catch { /* ignore */ }
      }

      // ── JSON output ──────────────────────────────────────────────────────
      if (opts.json) {
        risks.sort((a, b) => b.score - a.score);
        const critical = risks.filter(r => r.severity === 'critical');
        const warning  = risks.filter(r => r.severity === 'warning');
        console.log(JSON.stringify({
          namespace: opts.namespace ?? 'all', threshold,
          total: risks.length, critical: critical.length, warning: warning.length, risks,
        }, null, 2));
        return;
      }

      // ── Build pod map and render ─────────────────────────────────────────
      const podMap = buildPodMap(risks);
      renderArticleStyle(podMap, nsLabel, threshold);

      // ── AI deep analysis ─────────────────────────────────────────────────
      if (opts.ai && Object.keys(podMap).length > 0) {
        const spinner2 = ora('AI predicting failure timeline…').start();
        const context  = JSON.stringify(risks.slice(0, 15), null, 2);
        try {
          const result = await analyze(context, SYSTEM_PROMPT, null);
          spinner2.stop();
          console.log(chalk.bold('  AI prediction:\n'));
          if (result.summary) console.log(`  ${chalk.hex('#94a3b8')(result.summary)}\n`);
          if (result.fixSteps) {
            console.log(chalk.bold('  Preventive actions:\n'));
            result.fixSteps.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
        } catch {
          spinner2.stop();
        }
      }
    });
}
