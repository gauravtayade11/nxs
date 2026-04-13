/**
 * nxs predict — Predict failures before they happen
 * Analyzes current resource usage vs limits, restart trends,
 * PVC capacity, and node pressure to surface at-risk workloads.
 */
import chalk from 'chalk';
import { printBanner } from '../core/ui.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';
import { checkDeps } from '../core/deps.js';

const SYSTEM_PROMPT = `You are a Kubernetes SRE. You will receive a list of at-risk pods with their actual names, namespaces, severities, and issues.

Your job: give specific, actionable advice using the EXACT pod names and namespaces from the input. NEVER use placeholders like <pod-name> or <namespace> — always use the real values from the data.

Return a JSON object with exactly this structure:
{
  "tool": "predict",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentences: which specific pods are most at risk and why>",
  "atRisk": [
    {
      "resource": "<exact pod name from input>",
      "risk": "<what will happen to this specific pod>",
      "timeframe": "<imminent|under load|< 1h|< 24h>",
      "recommendation": "<exact kubectl command using real pod name and namespace>"
    }
  ],
  "rootCause": "<pattern across these specific pods — e.g. memory limits too low, missing requests, no HPA>",
  "fixSteps": ["<step 1 with real pod name>", "<step 2 with real pod name>"],
  "commands": ["<exact kubectl command 1>", "<exact kubectl command 2>"]
}

Rules:
- Each pod in the input has a "recommendedFixes" array with pre-computed commands — use those EXACT commands in your response, do not invent different memory values
- These are Pods, NOT Deployments — use "kubectl set resources pod/<name>" not "kubectl set resources deployment/<name>"
- Memory flag is "--requests=memory=<value>" not "--requests=mem=<value>"
- Use real pod names and namespaces from the input — never use placeholders
- Do NOT suggest "kubectl apply -f <file>.yaml" — we don't have local files
- Do NOT suggest "kubectl rollout restart" for standalone pods — use "kubectl delete pod" instead
- fixSteps must be an array of strings, one action per item
- commands must be an array of exact runnable kubectl commands from the recommendedFixes, one per item
- Order atRisk by urgency: critical first, then warning

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

    if (r.severity === 'critical') entry.severity = 'critical';
    if (r.score > entry.score) { entry.score = r.score; entry.primaryRisk = r.risk; }

    if (r._hasOOMKilled)  entry._hasOOMKilled  = true;
    if (r._hasCrashLoop)  entry._hasCrashLoop  = true;
    if (r._hasImagePull)  entry._hasImagePull  = true;
    if (r._hasPending)    entry._hasPending    = true;
    if (r._hpaExists)     entry._hpaExists     = true;
    if (r._restarts > entry._restarts) entry._restarts = r._restarts;
    if (r._memPct     != null) entry._memPct     = r._memPct;
    if (r._memLimitMi != null) entry._memLimitMi = r._memLimitMi;
    if (r._memUsedMi  != null) entry._memUsedMi  = r._memUsedMi;
    if (r._requestMi  != null) entry._requestMi  = r._requestMi;
    if (r._limitMi    != null) entry._limitMi    = r._limitMi;

    const text = r._findingText ?? r.detail;
    if (text && !entry.findings.includes(text)) entry.findings.push(text);
  }

  // ── Clean up duplicate / noisy findings ──────────────────────────────────
  for (const entry of Object.values(map)) {
    entry.findings = entry.findings.filter(f => {
      if (/^\d+ restarts —/.test(f) && entry.findings.some(g => /^Status:.*\(\d+ restarts\)/.test(g))) return false;
      if (f === 'No horizontal autoscaling configured') return false;
      return true;
    });
  }

  return map;
}

// ── Generate per-pod fix actions (rec + paired command) ──────────────────────
function generateActions(podName, ns, entry) {
  const actions = [];

  if (entry._hasOOMKilled || (entry._memPct !== null && entry._memPct >= 90)) {
    const baseMi = entry._memLimitMi ?? entry._limitMi ?? 128;
    const newMi  = Math.ceil(Math.max(baseMi * 1.5, baseMi + 64) / 64) * 64;
    actions.push({
      text: `Increase memory limit to ${newMi}Mi (current ${baseMi}Mi is too low)`,
      cmd:  `kubectl set resources pod/${podName} --requests=memory=${newMi}Mi --limits=memory=${newMi}Mi -n ${ns}`,
    });
    if (!entry._hpaExists) {
      actions.push({ text: `Add HPA to handle traffic spikes automatically`, cmd: null });
    }
  } else if (entry._requestMi != null && entry._limitMi != null && entry._limitMi > entry._requestMi * 1.5) {
    actions.push({
      text: `Align memory request to limit — ${entry._requestMi}Mi → ${entry._limitMi}Mi gap misleads the scheduler`,
      cmd:  `kubectl set resources pod/${podName} --requests=memory=${entry._limitMi}Mi --limits=memory=${entry._limitMi}Mi -n ${ns}`,
    });
  }

  if (entry._hasCrashLoop || entry._restarts >= 5) {
    actions.push({
      text: `Check crash logs to find the root cause`,
      cmd:  `kubectl logs ${podName} -n ${ns} --previous`,
    });
  }

  if (entry._hasImagePull) {
    actions.push({
      text: `Verify image name/tag and registry credentials`,
      cmd:  `kubectl describe pod ${podName} -n ${ns}`,
    });
  }

  if (entry._hasPending) {
    actions.push({
      text: `Check why pod can't be scheduled (node selector, taints, resources)`,
      cmd:  `kubectl describe pod ${podName} -n ${ns}`,
    });
  }

  if (actions.length === 0) {
    actions.push({ text: `Inspect pod for details`, cmd: `kubectl describe pod ${podName} -n ${ns}` });
  }

  return actions;
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderArticleStyle(podMap, nsLabel, threshold) {
  const pods = Object.values(podMap).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.score - a.score;
  });

  if (pods.length === 0) {
    console.log(chalk.green('\n  ✓ No at-risk pods detected.\n'));
    console.log(chalk.dim(`  All resources are below the ${threshold}% alert threshold.\n`));
    return;
  }

  const div = '  ' + chalk.dim('─'.repeat(54));

  console.log('');
  console.log(`  ${chalk.bold(`◈  PREDICT — at-risk pods · namespace: ${nsLabel}`)}`);
  console.log(div);

  for (const pod of pods) {
    const podName = pod.resource.replace(/^pod\//, '');
    const icon  = pod.severity === 'critical' ? chalk.red('✗') : chalk.yellow('⚠');
    const badge = pod.severity === 'critical'
      ? chalk.bgRed.white.bold(' CRITICAL ')
      : chalk.bgYellow.black.bold(' WARNING  ');

    const gap = Math.max(1, 44 - podName.length);
    console.log(`\n  ${icon}  ${chalk.white.bold(podName)}${' '.repeat(gap)}${badge}`);

    for (const f of pod.findings) {
      console.log(`     ${chalk.hex('#94a3b8')(f)}`);
    }
    console.log(`     ${chalk.dim('→')} ${chalk.yellow(pod.primaryRisk)}`);
  }

  console.log('\n' + div);
  console.log(`\n  ${chalk.bold('WHAT TO FIX')}\n`);

  for (const pod of pods) {
    const podName = pod.resource.replace(/^pod\//, '');
    const actions = generateActions(podName, pod.namespace, pod);

    console.log(`  ${chalk.white.bold(podName)}`);
    for (const { text, cmd } of actions) {
      console.log(`    ${chalk.dim('›')} ${chalk.hex('#94a3b8')(text)}`);
      if (cmd) console.log(`      ${chalk.cyan(cmd)}`);
    }
    console.log('');
  }
}

// ── Pod state + restart scanning ─────────────────────────────────────────────
function scanPodStates(podSpecs, hpaPods) {
  const risks = [];
  for (const spec of podSpecs) {
    const podName  = spec.metadata?.name ?? '';
    const podNs    = spec.metadata?.namespace ?? '';
    const restarts = spec.status?.containerStatuses?.reduce((s, c) => s + (c.restartCount ?? 0), 0) ?? 0;
    const hpaExists = hpaPods.has(podName);

    // ── Static request/limit ratio analysis ──
    for (const c of (spec.spec?.containers ?? [])) {
      const reqMem = parseMemory(c.resources?.requests?.memory ?? '0');
      const limMem = parseMemory(c.resources?.limits?.memory   ?? '0');
      const reqMi  = reqMem ? bytesToMi(reqMem) : null;
      const limMi  = limMem ? bytesToMi(limMem) : null;

      if (reqMi != null && limMi != null && limMi > 0 && limMi > reqMi * 2) {
        risks.push({
          type: 'pod-ratio', severity: 'warning',
          resource: `pod/${podName}`, namespace: podNs,
          metric: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
          detail: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
          risk: 'Memory spike will OOMKill this container',
          timeframe: 'under load', score: 60,
          recommendation: `kubectl set resources pod/${podName} --requests=memory=${limMi}Mi --limits=memory=${limMi}Mi -n ${podNs}`,
          _findingText: `Request/limit ratio: ${reqMi}Mi → ${limMi}Mi (${Math.round(limMi / reqMi)}× gap)`,
          _requestMi: reqMi, _limitMi: limMi, _hpaExists: hpaExists,
        });
        if (!hpaExists) {
          risks.push({
            type: 'pod-no-hpa', severity: 'warning',
            resource: `pod/${podName}`, namespace: podNs,
            metric: 'No horizontal autoscaling configured',
            detail: 'No horizontal autoscaling configured',
            risk: 'Memory spike will OOMKill this container',
            timeframe: 'under load', score: 55, recommendation: '',
            _findingText: 'No horizontal autoscaling configured', _hpaExists: false,
          });
        }
      }
    }

    // ── Container state checks ──
    for (const cs of (spec.status?.containerStatuses ?? [])) {
      const reason       = cs.state?.waiting?.reason ?? cs.state?.terminated?.reason ?? '';
      const lastReason   = cs.lastState?.terminated?.reason   ?? '';
      const lastExitCode = cs.lastState?.terminated?.exitCode ?? 0;

      if (!['CrashLoopBackOff', 'OOMKilled', 'Error', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerError'].includes(reason)) continue;

      const isCritical = reason === 'OOMKilled' || reason === 'CrashLoopBackOff';
      const isOOM      = reason === 'OOMKilled' || lastReason === 'OOMKilled' || lastExitCode === 137;
      const isCrash    = reason === 'CrashLoopBackOff';
      const isImgPull  = reason === 'ImagePullBackOff' || reason === 'ErrImagePull';

      const lines = [`Status: ${reason}${restarts > 0 ? ` (${restarts} restarts)` : ''}`];
      if (isOOM) lines.push(`Last termination: OOMKilled`);
      for (const c of (spec.spec?.containers ?? [])) {
        const limMem = parseMemory(c.resources?.limits?.memory ?? '0');
        if (limMem > 0 && isOOM) lines.push(`Memory limit: ${bytesToMi(limMem)}Mi — container exceeded limit`);
      }

      risks.push({
        type: 'pod-state', severity: isCritical ? 'critical' : 'warning',
        resource: `pod/${podName}`, namespace: podNs,
        metric: reason, detail: lines[0],
        risk: isOOM ? 'Will OOMKill again without memory increase' : `Container stuck in ${reason}`,
        timeframe: 'now', score: isCritical ? 95 : 75,
        recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
        _findingText: null, _hasOOMKilled: isOOM, _hasCrashLoop: isCrash,
        _hasImagePull: isImgPull, _restarts: restarts, _hpaExists: hpaExists,
        _extraLines: lines.slice(1),
      });
      for (const line of lines.slice(1)) {
        risks.push({
          type: 'pod-state-detail', severity: isCritical ? 'critical' : 'warning',
          resource: `pod/${podName}`, namespace: podNs,
          metric: line, detail: line, risk: '',
          timeframe: 'now', score: isCritical ? 94 : 74, recommendation: '',
          _findingText: line, _hpaExists: hpaExists,
        });
      }
    }

    // ── High restart count ──
    if (restarts >= 5) {
      risks.push({
        type: 'pod-restarts', severity: restarts >= 20 ? 'critical' : 'warning',
        resource: `pod/${podName}`, namespace: podNs,
        metric: `${restarts} restarts`,
        detail: `${restarts} restarts — recurring crash`,
        risk: 'CrashLoopBackOff imminent', timeframe: 'recurring',
        score: Math.min(restarts * 2, 100),
        recommendation: `kubectl logs ${podName} -n ${podNs} --previous`,
        _findingText: `${restarts} restarts — recurring crash`,
        _restarts: restarts, _hasCrashLoop: restarts >= 20, _hpaExists: hpaExists,
      });
    }

    // ── Pending pod ──
    if (spec.status?.phase === 'Pending' && (spec.status?.containerStatuses?.length ?? 0) === 0) {
      risks.push({
        type: 'pod-pending', severity: 'warning',
        resource: `pod/${podName}`, namespace: podNs,
        metric: 'Pending', detail: 'Pod stuck in Pending — cannot be scheduled',
        risk: 'Pod never starts — scheduling failure', timeframe: 'now', score: 70,
        recommendation: `kubectl describe pod ${podName} -n ${podNs}`,
        _findingText: 'Pod stuck in Pending — cannot be scheduled',
        _hasPending: true, _hpaExists: hpaExists,
      });
    }
  }
  return risks;
}

// ── Resource usage vs limits (requires metrics-server) ───────────────────────
function scanResourceUsage(topPodsR, podSpecs, hpaPods, threshold) {
  const risks = [];
  if (!topPodsR.stdout?.trim() || podSpecs.length === 0) return risks;

  for (const line of topPodsR.stdout.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [podName, cpuStr, memStr] = parts;

    const spec = podSpecs.find((p) => p.metadata?.name === podName);
    if (!spec) continue;

    let memLimit = 0, cpuLimit = 0, memRequest = 0;
    for (const c of (spec.spec?.containers ?? [])) {
      memLimit   += parseMemory(c.resources?.limits?.memory   ?? '0');
      cpuLimit   += parseCPU(c.resources?.limits?.cpu         ?? '0');
      memRequest += parseMemory(c.resources?.requests?.memory ?? '0');
    }

    const memUsed   = parseMemory(memStr);
    const cpuUsed   = parseCPU(cpuStr);
    const memPct    = pct(memUsed, memLimit);
    const cpuPct    = pct(cpuUsed, cpuLimit);
    const podNs     = spec.metadata?.namespace ?? '';
    const hpaExists = hpaPods.has(podName);

    if (memPct !== null && memPct >= threshold) {
      const usedMi  = bytesToMi(memUsed);
      const limitMi = bytesToMi(memLimit);
      const reqMi   = memRequest ? bytesToMi(memRequest) : null;
      const tf      = memPct >= 95 ? 'imminent' : memPct >= 90 ? '< 1h' : '< 24h';
      risks.push({
        type: 'pod-memory', severity: memPct >= 90 ? 'critical' : 'warning',
        resource: `pod/${podName}`, namespace: podNs,
        metric: `Memory ${memPct}% of limit`,
        detail: `Memory: ${usedMi}Mi of ${limitMi}Mi limit (${memPct}%)`,
        risk: 'OOMKilled', timeframe: tf, score: memPct,
        recommendation: `kubectl set resources pod/${podName} --limits=memory=${Math.round(limitMi * 1.5 / 64) * 64}Mi -n ${podNs}`,
        _findingText: `Memory: ${usedMi}Mi of ${limitMi}Mi limit (${memPct}%)`,
        _memPct: memPct, _memLimitMi: limitMi, _memUsedMi: usedMi,
        _requestMi: reqMi, _limitMi: limitMi, _hasOOMKilled: false, _hpaExists: hpaExists,
      });
    }

    if (cpuPct !== null && cpuPct >= threshold) {
      risks.push({
        type: 'pod-cpu', severity: 'warning',
        resource: `pod/${podName}`, namespace: podNs,
        metric: `CPU ${cpuPct}% of limit`,
        detail: `CPU: ${cpuStr} of ${(cpuLimit * 1000).toFixed(0)}m limit (${cpuPct}%)`,
        risk: 'CPU throttling / slow responses', timeframe: 'ongoing', score: cpuPct,
        recommendation: `Increase CPU limit or add HPA for auto-scaling`,
        _findingText: `CPU: ${cpuStr} of ${(cpuLimit * 1000).toFixed(0)}m limit (${cpuPct}%)`,
        _hpaExists: hpaExists,
      });
    }
  }
  return risks;
}

// ── Node pressure ─────────────────────────────────────────────────────────────
function scanNodePressure(nodesR) {
  const risks = [];
  if (!nodesR.stdout?.trim()) return risks;
  try {
    const nodeList = JSON.parse(nodesR.stdout).items ?? [];
    for (const node of nodeList) {
      for (const cond of (node.status?.conditions ?? [])) {
        if (['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(cond.type) && cond.status === 'True') {
          risks.push({
            type: 'node-pressure', severity: 'critical',
            resource: `node/${node.metadata?.name}`, namespace: 'cluster',
            metric: cond.type, detail: cond.message ?? cond.type,
            risk: 'Node evictions — pods will be killed', timeframe: 'ongoing', score: 95,
            recommendation: `kubectl describe node ${node.metadata?.name}`,
            _findingText: cond.message ?? cond.type,
          });
        }
      }
    }
  } catch { /* ignore */ }
  return risks;
}

// ── PVC health ────────────────────────────────────────────────────────────────
function scanPvcHealth(pvcR) {
  const risks = [];
  if (!pvcR.stdout?.trim()) return risks;
  try {
    const pvcList = JSON.parse(pvcR.stdout).items ?? [];
    for (const pvc of pvcList) {
      if (pvc.status?.phase !== 'Bound') {
        risks.push({
          type: 'pvc-unbound', severity: 'warning',
          resource: `pvc/${pvc.metadata?.name}`, namespace: pvc.metadata?.namespace ?? '',
          metric: `Phase: ${pvc.status?.phase}`,
          detail: `PVC ${pvc.status?.phase} — pods requiring this volume will be Pending`,
          risk: 'Pod stuck in Pending', timeframe: 'now', score: 80,
          recommendation: `kubectl describe pvc ${pvc.metadata?.name} -n ${pvc.metadata?.namespace}`,
          _findingText: `PVC ${pvc.status?.phase} — pods requiring this volume will be Pending`,
        });
      }
    }
  } catch { /* ignore */ }
  return risks;
}

// ── Core scan — orchestrates all checks and returns podMap ───────────────────
async function runScan(opts, threshold, ns) {
  const ora = (await import('ora')).default;
  const spinner = opts.json ? null : ora('Collecting cluster metrics…').start();

  const [topPodsR, podsR, nodesR, , pvcR, hpaR] = await Promise.all([
    run(`kubectl top pods ${ns} --no-headers 2>/dev/null`),
    run(`kubectl get pods ${ns} -o json 2>/dev/null`),
    run(`kubectl get nodes -o json 2>/dev/null`),
    run(`kubectl top nodes --no-headers 2>/dev/null`),
    run(`kubectl get pvc ${ns} -o json 2>/dev/null`),
    run(`kubectl get hpa ${ns} -o json 2>/dev/null`),
  ]);

  spinner?.stop();

  const hpaPods = new Set();
  if (hpaR.stdout?.trim()) {
    try {
      const hpaList = JSON.parse(hpaR.stdout).items ?? [];
      for (const h of hpaList) hpaPods.add(h.spec?.scaleTargetRef?.name ?? '');
    } catch { /* ignore */ }
  }

  let podSpecs = [];
  if (podsR.stdout?.trim()) {
    try { podSpecs = JSON.parse(podsR.stdout).items ?? []; } catch { /* ignore */ }
  }

  const risks = [
    ...scanPodStates(podSpecs, hpaPods),
    ...scanResourceUsage(topPodsR, podSpecs, hpaPods, threshold),
    ...scanNodePressure(nodesR),
    ...scanPvcHealth(pvcR),
  ];

  return { risks, podMap: buildPodMap(risks) };
}

// ── AI deep analysis ─────────────────────────────────────────────────────────
async function runAiAnalysis(podMap) {
  const ora = (await import('ora')).default;
  const spinner2 = ora('AI predicting failure timeline…').start();

  const podSummary = Object.values(podMap).map(p => {
    const podName = p.resource.replace(/^pod\//, '');
    const actions = generateActions(podName, p.namespace, p);
    return {
      pod:        podName,
      namespace:  p.namespace,
      severity:   p.severity,
      findings:   p.findings,
      risk:       p.primaryRisk,
      restarts:   p._restarts || undefined,
      memLimitMi: p._memLimitMi ?? p._limitMi ?? undefined,
      memPct:     p._memPct ?? undefined,
      oomKilled:  p._hasOOMKilled || undefined,
      requestMi:  p._requestMi ?? undefined,
      recommendedFixes: actions.filter(a => a.cmd).map(a => ({
        action: a.text,
        command: a.cmd,
      })),
    };
  });

  try {
    const result = await analyze(JSON.stringify(podSummary, null, 2), SYSTEM_PROMPT, null);
    spinner2.stop();

    // Replace <pod>/<namespace> placeholders — Groq ignores the instruction sometimes
    const firstCritical = podSummary.find(p => p.severity === 'critical') ?? podSummary[0];
    if (firstCritical) {
      const substStr = (s) => String(s)
        .replace(/<pod(-name)?>/g, firstCritical.pod)
        .replace(/<namespace>/g,   firstCritical.namespace)
        .replace(/<image(:[^>]*)?>/g, `$(kubectl get pod ${firstCritical.pod} -n ${firstCritical.namespace} -o jsonpath='{.spec.containers[0].image}')`);
      // Preserve original type so existing renderers work correctly
      const subst = (v) => Array.isArray(v) ? v.map(substStr) : substStr(v);
      if (result.commands)  result.commands  = subst(result.commands);
      if (result.fixSteps)  result.fixSteps  = subst(result.fixSteps);
    }

    const div = '  ' + chalk.dim('─'.repeat(54));
    console.log('\n' + div);
    console.log(`\n  ${chalk.bold('AI PREDICTION')}\n`);

    if (result.summary) console.log(`  ${chalk.hex('#94a3b8')(result.summary)}\n`);

    if (Array.isArray(result.atRisk) && result.atRisk.length > 0) {
      console.log(`  ${chalk.bold('Failure timeline:')}\n`);
      for (const r of result.atRisk) {
        const tf = r.timeframe ? chalk.yellow(` [${r.timeframe}]`) : '';
        console.log(`  ${chalk.red('→')} ${chalk.white.bold(r.resource)}${tf}`);
        if (r.risk) console.log(`     ${chalk.hex('#94a3b8')(r.risk)}`);
        if (r.recommendation) {
          console.log(`     ${chalk.dim('Fix:')}`);
          console.log(`       ${chalk.cyan(r.recommendation)}`);
        }
      }
      console.log('');
    }

    if (result.rootCause) {
      const lines = Array.isArray(result.rootCause) ? result.rootCause : result.rootCause.split('\n');
      const filtered = lines.map(l => l.trim()).filter(l => l.length > 0);
      if (filtered.length > 0) {
        console.log(`  ${chalk.bold('Root cause pattern:')}\n`);
        filtered.forEach(l => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
        console.log('');
      }
    }

    if (result.fixSteps) {
      const steps = Array.isArray(result.fixSteps) ? result.fixSteps : result.fixSteps.split('\n');
      const filtered = steps.map(l => l.trim()).filter(l => l.length > 0);
      if (filtered.length > 0) {
        console.log(`  ${chalk.bold('Preventive actions:')}\n`);
        filtered.forEach((l, i) => {
          const text = l.replace(/^\d+\.\s*/, '');
          console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.hex('#94a3b8')(text)}`);
        });
        console.log('');
      }
    }

    if (result.commands) {
      const cmds = Array.isArray(result.commands) ? result.commands : result.commands.split(/\n|&&|;/);
      const filtered = cmds.map(l => l.trim()).filter(l => l.length > 0);
      if (filtered.length > 0) {
        console.log(`  ${chalk.bold('Commands:')}\n`);
        filtered.forEach(l => console.log(`    ${chalk.cyan(l)}`));
        console.log('');
      }
    }

    console.log(div + '\n');
  } catch {
    spinner2.stop();
  }
}

async function runWatchMode(opts, threshold, ns, nsLabel) {
  const intervalMin = Math.max(1, Number.parseInt(opts.interval, 10) || 5);
  const intervalMs  = intervalMin * 60 * 1000;

  if (!opts.json) {
    printBanner('Predict — failure prediction engine');
    console.log(chalk.dim(`  Scanning: ${nsLabel}  |  Threshold: ${threshold}%  |  Interval: ${intervalMin}m\n`));
    console.log(chalk.dim('  Watch mode active — Ctrl+C to stop\n'));
    console.log('  ' + chalk.dim('─'.repeat(54)));
  }

  let prevKeys = new Set();

  const tick = async () => {
    const ts = new Date().toLocaleTimeString();
    if (!opts.json) console.log(`\n  ${chalk.dim('◷')} ${chalk.dim(`Scan at ${ts}`)}`);

    const { risks, podMap } = await runScan(opts, threshold, ns);
    const currentKeys = new Set(Object.keys(podMap));

    if (opts.json) {
      risks.sort((a, b) => b.score - a.score);
      const critical = risks.filter(r => r.severity === 'critical');
      const warning  = risks.filter(r => r.severity === 'warning');
      console.log(JSON.stringify({
        ts, namespace: opts.namespace ?? 'all', threshold,
        total: risks.length, critical: critical.length, warning: warning.length,
        new: [...currentKeys].filter(k => !prevKeys.has(k)).length,
        resolved: [...prevKeys].filter(k => !currentKeys.has(k)).length,
        risks,
      }, null, 2));
      prevKeys = currentKeys;
      return;
    }

    const newKeys      = [...currentKeys].filter(k => !prevKeys.has(k));
    const resolvedKeys = [...prevKeys].filter(k => !currentKeys.has(k));

    if (newKeys.length > 0) {
      console.log('');
      for (const key of newKeys) {
        const pod     = podMap[key];
        const podName = pod.resource.replace(/^pod\//, '');
        const badge   = pod.severity === 'critical' ? chalk.bgRed.white.bold(' CRITICAL ') : chalk.bgYellow.black.bold(' WARNING  ');
        const icon    = pod.severity === 'critical' ? chalk.red('✗') : chalk.yellow('⚠');
        console.log(`  ${icon}  ${chalk.white.bold('NEW RISK')}  ${chalk.white(podName)}  ${badge}`);
        for (const f of pod.findings) console.log(`     ${chalk.hex('#94a3b8')(f)}`);
        console.log(`     ${chalk.dim('→')} ${chalk.yellow(pod.primaryRisk)}`);
        const actions = generateActions(podName, pod.namespace, pod);
        for (const { text, cmd } of actions.slice(0, 2)) {
          console.log(`     ${chalk.dim('›')} ${chalk.hex('#94a3b8')(text)}`);
          if (cmd) console.log(`       ${chalk.cyan(cmd)}`);
        }
      }
    }

    for (const key of resolvedKeys) {
      const [resource] = key.split('::');
      console.log(`  ${chalk.green('✓')}  ${chalk.green.bold('RESOLVED')}  ${chalk.dim(resource.replace(/^pod\//, ''))}`);
    }

    if (newKeys.length === 0 && resolvedKeys.length === 0) {
      const count = currentKeys.size;
      console.log(count === 0
        ? `  ${chalk.green('✓')} ${chalk.dim('All clear — no at-risk pods')}`
        : `  ${chalk.dim(`${count} at-risk pod(s) unchanged`)}`);
    }

    console.log('  ' + chalk.dim('─'.repeat(54)));
    prevKeys = currentKeys;
  };

  await tick();
  const timer = setInterval(tick, intervalMs);
  process.once('SIGINT', () => {
    clearInterval(timer);
    console.log('\n' + chalk.dim('  Watch stopped.\n'));
    process.exit(0);
  });
  await new Promise(() => {});
}

export function registerPredict(program) {
  program
    .command('predict')
    .description('Predict pod OOMKills, disk exhaustion, and resource failures before they happen')
    .option('-n, --namespace <ns>', 'Namespace to scan (default: all)')
    .option('--threshold <n>', 'Warn when usage exceeds N% of limit (default: 75)', '75')
    .option('--ai', 'Use AI for deeper risk analysis')
    .option('-j, --json', 'Output as JSON')
    .option('--watch', 'Run continuously — re-scan every interval and alert on new risks')
    .option('--interval <min>', 'Watch mode scan interval in minutes (default: 5)', '5')
    .addHelpText('after', `
Examples:
  $ nxs predict
  $ nxs predict -n production
  $ nxs predict --threshold 80 --ai
  $ nxs predict --watch
  $ nxs predict --watch --interval 2 -n production`)
    .action(async (opts) => {
      if (!await checkDeps('kubectl')) { process.exit(1); }
      const threshold = Number.parseInt(opts.threshold, 10) || 75;
      const ns        = opts.namespace ? `-n "${opts.namespace}"` : '--all-namespaces';
      const nsLabel   = opts.namespace ?? 'all namespaces';

      // ── Watch mode ────────────────────────────────────────────────────────
      if (opts.watch) {
        await runWatchMode(opts, threshold, ns, nsLabel);
        return;
      }

      // ── Single scan ───────────────────────────────────────────────────────
      if (!opts.json) {
        printBanner('Predict — failure prediction engine');
        console.log(chalk.dim(`  Scanning: ${nsLabel}  |  Alert threshold: ${threshold}%\n`));
      }

      const { risks, podMap } = await runScan(opts, threshold, ns);

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

      renderArticleStyle(podMap, nsLabel, threshold);

      if (opts.ai && Object.keys(podMap).length > 0) {
        await runAiAnalysis(podMap);
      }
    });
}
