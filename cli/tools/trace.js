/**
 * nxs trace — HTTP request tracer
 * Hits a URL, measures response time, finds the pod that handled it,
 * fetches logs, correlates CPU/memory, and shows the full request flow.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { run } from '../core/exec.js';
import { analyze } from '../core/ai.js';
import { checkDeps } from '../core/deps.js';

const SYSTEM_PROMPT = `You are an SRE analyzing an HTTP request trace through a Kubernetes cluster.
Given timing data, pod logs, and resource usage at the time of the request, identify bottlenecks.

Return a JSON object with exactly this structure:
{
  "tool": "trace",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary of the request flow>",
  "bottleneck": "<which hop or component is slowest>",
  "rootCause": "<why it is slow>",
  "fixSteps": "<numbered steps to improve performance>",
  "commands": "<kubectl commands to investigate further>"
}

Return ONLY valid JSON. No markdown fences.`;

function fmtMs(ms) {
  if (ms === null || ms === undefined) return chalk.dim('?ms');
  if (ms >= 1000) return chalk.red.bold(`${(ms / 1000).toFixed(2)}s`);
  if (ms >= 200)  return chalk.yellow(`${ms}ms`);
  return chalk.green(`${ms}ms`);
}

function bar(ms, total) {
  if (!ms || !total) return '';
  const pct   = Math.min(Math.round((ms / total) * 20), 20);
  const color = ms / total >= 0.6 ? chalk.red : ms / total >= 0.3 ? chalk.yellow : chalk.green;
  return color('█'.repeat(pct) + '░'.repeat(20 - pct));
}

async function getPodForService(svcName, namespace) {
  const ns = namespace ? `-n ${namespace}` : '';
  const r   = await run(`kubectl get endpoints ${svcName} ${ns} -o jsonpath='{.subsets[0].addresses[0].targetRef.name}' 2>/dev/null`);
  return r.stdout?.trim() ?? null;
}

async function getRecentLogs(podName, namespace, lines = 20) {
  const ns = namespace ? `-n ${namespace}` : '';
  const r   = await run(`kubectl logs ${podName} ${ns} --tail=${lines} 2>/dev/null`);
  return r.stdout?.trim() ?? '';
}

async function getResourceUsage(podName, namespace) {
  const ns = namespace ? `-n ${namespace}` : '';
  const r   = await run(`kubectl top pod ${podName} ${ns} --no-headers 2>/dev/null`);
  if (!r.stdout?.trim()) return null;
  const parts = r.stdout.trim().split(/\s+/);
  return { cpu: parts[1] ?? '?', memory: parts[2] ?? '?' };
}

async function discoverServices(namespace) {
  const ns = namespace ? `-n ${namespace}` : '';
  const r   = await run(`kubectl get svc ${ns} -o json 2>/dev/null`);
  if (!r.stdout?.trim()) return [];
  try {
    return (JSON.parse(r.stdout).items ?? [])
      .filter(s => s.metadata?.name !== 'kubernetes')
      .map(s => ({
        name: s.metadata?.name,
        port: s.spec?.ports?.[0]?.port,
        targetPort: s.spec?.ports?.[0]?.targetPort,
        selector: s.spec?.selector ?? {},
      }));
  } catch { return []; }
}

async function makeRequest(url) {
  const start = Date.now();
  try {
    const res     = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const elapsed = Date.now() - start;
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { ok: true, status: res.status, elapsed, headers: Object.fromEntries(res.headers), body };
  } catch (e) {
    return { ok: false, error: e.message, elapsed: Date.now() - start };
  }
}

async function queryJaeger(jaegerUrl, service, limit = 5, sinceMs = null) {
  try {
    let url = `${jaegerUrl}/api/traces?service=${encodeURIComponent(service)}&limit=${limit}`;
    if (sinceMs) url += `&start=${sinceMs * 1000}`;   // Jaeger uses microseconds
    const res  = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? [];
  } catch { return null; }
}

async function getJaegerServices(jaegerUrl) {
  try {
    const res  = await fetch(`${jaegerUrl}/api/services`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data ?? [];
  } catch { return []; }
}

// ── Live waterfall helpers ────────────────────────────────────────────────────

function waterfallBar(ms, maxMs, width = 20) {
  if (!ms || !maxMs) return '░'.repeat(width);
  const filled = Math.min(Math.round((ms / maxMs) * width), width);
  const color   = ms / maxMs >= 0.6 ? chalk.red : ms / maxMs >= 0.3 ? chalk.yellow : chalk.green;
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

function buildSpanTree(spans) {
  // Build parent→children map
  const byId   = {};
  const roots  = [];
  for (const s of spans) byId[s.spanID] = { ...s, children: [] };
  for (const s of spans) {
    const parent = s.references?.find(r => r.refType === 'CHILD_OF');
    if (parent && byId[parent.spanID]) {
      byId[parent.spanID].children.push(byId[s.spanID]);
    } else {
      roots.push(byId[s.spanID]);
    }
  }
  return roots;
}

function renderSpanTree(nodes, procMap, totalMs, prefix = '', isRoot = false) {
  const lines = [];
  nodes.forEach((node, idx) => {
    const isLast     = idx === nodes.length - 1;
    const connector  = isRoot ? '' : isLast ? '└─ ' : '├─ ';
    const childPfx   = isRoot ? '' : isLast ? '   ' : '│  ';
    const durationMs = Math.round(node.duration / 1000);
    const svc        = procMap[node.processID]?.serviceName ?? '?';
    const label      = `${svc}:${node.operationName}`;
    const tags       = Object.fromEntries((node.tags ?? []).map(t => [t.key, t.value]));
    const isError    = node.tags?.some(t =>
      (t.key === 'error' && (t.value === true || t.value === 'true')) ||
      (t.key === 'otel.status_code' && t.value === 'ERROR'));
    const isSlow     = durationMs > 100;

    const nameColor = isError ? chalk.red : isSlow ? chalk.yellow : chalk.white;
    const slowFlag  = isSlow  ? chalk.red.bold('  ← SLOW')  : '';
    const errFlag   = isError ? chalk.red.bold('  ← ERROR') : '';

    const barStr = waterfallBar(durationMs, totalMs);
    const msStr  = fmtMs(durationMs);
    const labelPad = label.slice(0, 28).padEnd(28);

    lines.push(`  ${prefix}${connector}${nameColor(labelPad)}  ${msStr.padStart(6)}   ${barStr}${slowFlag}${errFlag}`);

    if (tags['db.statement']) {
      lines.push(`  ${prefix}${childPfx}   ${chalk.dim('sql:')} ${chalk.dim(String(tags['db.statement']).slice(0, 60))}`);
    }
    if (tags['http.url']) {
      lines.push(`  ${prefix}${childPfx}   ${chalk.dim('http:')} ${tags['http.method'] ?? 'GET'} ${tags['http.url']}`);
    }

    if (node.children?.length > 0) {
      lines.push(...renderSpanTree(node.children, procMap, totalMs, prefix + childPfx));
    }
  });
  return lines;
}

async function runLiveWaterfall(jaegerUrl, opts) {
  const services      = await getJaegerServices(jaegerUrl);
  const targetService = opts.service ?? (services[0] ?? 'backend');
  const threshold     = Number(opts.slowMs ?? 200);
  const seen          = new Set();

  printBanner('Trace — live waterfall');
  console.log(chalk.dim(`  Jaeger: ${jaegerUrl}  |  Service: ${targetService}  |  Slow threshold: ${threshold}ms`));
  console.log(chalk.dim('  Waiting for requests… (Ctrl+C to stop)\n'));
  console.log(hr());

  let first      = true;
  // Only show traces that started after we launched (±60s grace for clock skew)
  const startedAt = Date.now() - 60_000;

  const poll = async () => {
    const traces = await queryJaeger(jaegerUrl, targetService, 20);
    if (!traces) return;

    for (const trace of traces) {
      if (seen.has(trace.traceID)) continue;
      seen.add(trace.traceID);

      const spans   = trace.spans ?? [];
      const procMap = trace.processes ?? {};
      if (spans.length === 0) continue;

      // Skip traces that started before we launched (filter old Jaeger history)
      const traceStartMs = Math.floor(spans[0].startTime / 1000);
      if (traceStartMs < startedAt) continue;

      // Root span = longest or first with no parent
      const roots    = buildSpanTree(spans);
      if (roots.length === 0) continue;

      const rootSpan  = roots[0];
      const totalMs   = Math.round(rootSpan.duration / 1000);
      const tags      = Object.fromEntries((rootSpan.tags ?? []).map(t => [t.key, t.value]));
      const method    = tags['http.method']  ?? 'GET';
      const urlPath   = tags['http.url']     ?? rootSpan.operationName;
      const status    = tags['http.status_code'] ?? '?';
      const startSec  = Math.floor(rootSpan.startTime / 1_000_000);
      const ts        = new Date(startSec * 1000).toLocaleTimeString('en-GB', { hour12: false });

      if (!first) console.log('');
      first = false;

      const statusColor = String(status).startsWith('2') ? chalk.green : chalk.red;
      console.log(`  ${chalk.dim(`[${ts}]`)}  ${chalk.cyan.bold(method)} ${chalk.white(urlPath)}  ${statusColor(status)}  ${fmtMs(totalMs)}`);

      // Render waterfall
      const treeRoots = buildSpanTree(spans);
      const treeLines = renderSpanTree(treeRoots, procMap, totalMs, '', true);
      treeLines.forEach(l => console.log(l));

      // AI on slow traces
      if (opts.ai && totalMs >= threshold) {
        const context = JSON.stringify({
          traceID: trace.traceID, totalMs,
          spans: spans.map(s => ({
            op: s.operationName,
            service: procMap[s.processID]?.serviceName,
            durationMs: Math.round(s.duration / 1000),
            tags: Object.fromEntries((s.tags ?? []).map(t => [t.key, t.value])),
          })),
        }, null, 2);
        try {
          const result = await analyze(context, SYSTEM_PROMPT, () => ({
            tool: 'trace', severity: totalMs > 1000 ? 'critical' : 'warning',
            summary: `Trace ${trace.traceID.slice(0, 8)} took ${totalMs}ms.`,
            bottleneck: targetService, rootCause: 'Add --ai flag with Groq key.',
            fixSteps: '1. Run nxs config --setup', commands: '',
          }));
          console.log(`\n  ${chalk.yellow('AI:')} ${chalk.hex('#94a3b8')(result.summary)}`);
          if (result.rootCause) console.log(`  ${chalk.dim('Root cause:')} ${chalk.hex('#94a3b8')(result.rootCause)}`);
        } catch { /* ignore */ }
      }
    }
  };

  // Poll loop
  await poll();
  const interval = setInterval(poll, 2000);

  // Ctrl+C cleanup
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n' + hr());
    console.log(chalk.dim('  Stopped.\n'));
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

export function registerTrace(program) {
  program
    .command('trace')
    .description('Trace an HTTP request through your services — timing, logs, CPU/memory per hop')
    .argument('[url]', 'URL to trace (e.g. http://localhost:8080/api/users)')
    .option('-n, --namespace <ns>', 'Kubernetes namespace')
    .option('--service <name>', 'Frontend service name (auto-detected if not set)')
    .option('--jaeger <url>', 'Jaeger UI URL for real span data (e.g. http://localhost:16686)')
    .option('--live', 'Live waterfall — poll Jaeger and print new traces as they arrive')
    .option('--slow-ms <ms>', 'Threshold for SLOW label in live mode (default: 200)', '200')
    .option('--count <n>', 'Number of requests to send (default: 3)', '3')
    .option('--ai', 'Use AI to analyze bottlenecks')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs trace http://localhost:8080/api/users -n trace-demo
  $ nxs trace http://localhost:8080/api/users -n trace-demo --jaeger http://localhost:16686
  $ nxs trace http://localhost:8080/api/users --count 5 --ai
  $ nxs trace http://localhost:8080/api/users -n trace-demo --jaeger http://localhost:16686 --ai
  $ nxs trace --jaeger http://localhost:16686 --live
  $ nxs trace --jaeger http://localhost:16686 --live --ai --slow-ms 100`)
    .action(async (url, opts) => {
      // kubectl needed for pod/service discovery (not for --live-only mode)
      if (!opts.live) await checkDeps('kubectl');

      // ── Live mode ──
      if (opts.live) {
        if (!opts.jaeger) {
          console.error(chalk.red('  --live requires --jaeger <url>  (e.g. --jaeger http://localhost:16686)'));
          process.exit(1);
        }
        await runLiveWaterfall(opts.jaeger, opts);
        return;
      }

      if (!url) {
        console.error(chalk.red('  Usage: nxs trace <url>\n  Example: nxs trace http://localhost:8080/api/users'));
        process.exit(1);
      }

      const ns      = opts.namespace;
      const count   = Number.parseInt(opts.count, 10) || 3;

      if (!opts.json) {
        printBanner('Trace — request flow analyzer');
        console.log(chalk.dim(`  URL: ${url}  |  Requests: ${count}  |  Namespace: ${ns ?? 'auto'}\n`));
      }

      const ora     = (await import('ora')).default;

      // ── Step 1: Make N requests, measure timing ──
      const spinner = opts.json ? null : ora('Sending requests…').start();
      const results = [];
      for (let i = 0; i < count; i++) {
        results.push(await makeRequest(url));
      }
      spinner?.stop();

      const successful = results.filter(r => r.ok);
      if (successful.length === 0) {
        console.error(chalk.red(`  Could not reach ${url}\n  Error: ${results[0].error}\n`));
        process.exit(1);
      }

      const times   = successful.map(r => r.elapsed);
      const avgMs   = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const minMs   = Math.min(...times);
      const maxMs   = Math.max(...times);
      const lastRes = successful[successful.length - 1];

      // Parse backend timing from response body if available
      let backendMs = null, dbMs = null;
      try {
        const body = JSON.parse(lastRes.body);
        backendMs  = body.backend_time_ms ?? null;
        dbMs       = body.db_time_ms ?? null;
      } catch { /* ignore */ }

      // ── Step 2: Discover services + pods ──
      const spinner2 = opts.json ? null : ora('Discovering services…').start();
      const services  = await discoverServices(ns);
      spinner2?.stop();

      // Map service → pod
      const hopData = [];
      for (const svc of services) {
        const podName = await getPodForService(svc.name, ns);
        if (!podName) continue;
        const [logs, usage] = await Promise.all([
          getRecentLogs(podName, ns, 15),
          getResourceUsage(podName, ns),
        ]);
        hopData.push({ service: svc.name, pod: podName, logs, usage });
      }

      // ── Step 3: Infer hop timings ──
      // frontend = total - backend, backend = backendMs, db = dbMs
      const frontendMs = backendMs ? Math.max(avgMs - backendMs, 0) : null;

      const hops = [];

      // Find frontend service
      const frontendSvc = hopData.find(h => h.service === (opts.service ?? 'frontend'));
      if (frontendSvc) {
        hops.push({
          from: 'client',
          to: frontendSvc.service,
          pod: frontendSvc.pod,
          ms: frontendMs,
          usage: frontendSvc.usage,
          logs: frontendSvc.logs,
        });
      }

      // Find backend service
      const backendSvc = hopData.find(h => h.service === 'backend');
      if (backendSvc) {
        hops.push({
          from: frontendSvc?.service ?? 'frontend',
          to: backendSvc.service,
          pod: backendSvc.pod,
          ms: backendMs ? backendMs - (dbMs ?? 0) : null,
          usage: backendSvc.usage,
          logs: backendSvc.logs,
        });
      }

      // DB hop
      const dbSvc = hopData.find(h => h.service === 'postgres' || h.service === 'mysql' || h.service === 'redis');
      if (dbSvc && dbMs) {
        hops.push({
          from: backendSvc?.service ?? 'backend',
          to: dbSvc.service,
          pod: dbSvc.pod,
          ms: dbMs,
          usage: dbSvc.usage,
          logs: dbSvc.logs,
        });
      }

      // Fallback: show all services even if timing unknown
      if (hops.length === 0) {
        for (const h of hopData) {
          hops.push({ from: '?', to: h.service, pod: h.pod, ms: null, usage: h.usage, logs: h.logs });
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ url, avgMs, minMs, maxMs, status: lastRes.status, hops, services: hopData }, null, 2));
        return;
      }

      // ── Output ──
      console.log(hr());
      console.log(chalk.bold(`\n  Request: ${chalk.cyan(`GET ${url}`)}\n`));
      console.log(`  Status      : ${lastRes.status === 200 ? chalk.green(lastRes.status) : chalk.red(lastRes.status)}`);
      console.log(`  Avg time    : ${fmtMs(avgMs)}  ${chalk.dim(`(min: ${minMs}ms  max: ${maxMs}ms  over ${count} requests)`)}`);
      console.log('');
      console.log(hr());

      // ── Hop timeline ──
      console.log(chalk.bold('\n  Request flow:\n'));

      const slowest = hops.reduce((a, b) => ((a.ms ?? 0) > (b.ms ?? 0) ? a : b), hops[0]);

      hops.forEach((hop, i) => {
        const isSlow  = hop === slowest && hop.ms && hop.ms > 100;
        const arrow   = chalk.dim('──►');
        const label   = `${hop.from} ${arrow} ${chalk.white.bold(hop.to)}`;
        const timing  = hop.ms ? `${fmtMs(hop.ms)}  ${bar(hop.ms, avgMs)}` : chalk.dim('timing unavailable');
        const slow    = isSlow ? chalk.red.bold('  ← SLOW') : '';
        const podLine = chalk.dim(`pod/${hop.pod}`);

        console.log(`  ${chalk.dim(`${i + 1}.`)} ${label}`);
        console.log(`     Time    : ${timing}${slow}`);
        console.log(`     Pod     : ${podLine}`);
        if (hop.usage) {
          console.log(`     CPU     : ${chalk.dim(hop.usage.cpu)}  Memory: ${chalk.dim(hop.usage.memory)}`);
        }
        console.log('');
      });

      console.log(hr());

      // ── Recent logs per service ──
      console.log(chalk.bold('\n  Recent logs:\n'));
      for (const hop of hops) {
        if (!hop.logs) continue;
        console.log(chalk.cyan(`  [${hop.to}]`));
        hop.logs.split('\n').slice(-5).forEach(l => {
          const line = l.trim();
          if (!line) return;
          const col = line.includes('ERROR') || line.includes('error') ? chalk.red
                    : line.includes('WARN')  ? chalk.yellow
                    : chalk.dim;
          console.log(`  ${col(line.slice(0, 100))}`);
        });
        console.log('');
      }

      console.log(hr());

      // ── Jaeger spans ──
      if (opts.jaeger) {
        const spinner3 = opts.json ? null : ora('Querying Jaeger for real spans…').start();
        const services  = await getJaegerServices(opts.jaeger);
        spinner3?.stop();

        if (services.length > 0) {
          console.log(chalk.bold('\n  Real spans (from Jaeger):\n'));

          for (const svc of services) {
            const traces = await queryJaeger(opts.jaeger, svc, 1);
            if (!traces || traces.length === 0) continue;

            const trace   = traces[0];
            const spans   = trace.spans ?? [];
            const procMap = trace.processes ?? {};

            spans.forEach((span) => {
              const durationMs = Math.round(span.duration / 1000);
              const proc       = procMap[span.processID]?.serviceName ?? svc;
              const tags       = Object.fromEntries((span.tags ?? []).map(t => [t.key, t.value]));
              const isError    = span.tags?.some(t =>
                (t.key === 'error' && (t.value === true || t.value === 'true')) ||
                (t.key === 'otel.status_code' && t.value === 'ERROR'));
              const isSlow     = durationMs > 100;
              const nameColor  = isError ? chalk.red : isSlow ? chalk.yellow : chalk.green;
              const slowFlag   = isSlow ? chalk.yellow('  ← SLOW') : '';
              const errFlag    = isError ? chalk.red('  ← ERROR') : '';

              console.log(`  ${chalk.cyan(`[${proc}]`)} ${nameColor(span.operationName)}  ${fmtMs(durationMs)}${slowFlag}${errFlag}`);

              if (tags['db.system'])    console.log(`    ${chalk.dim('db:')} ${tags['db.system']}  query: ${tags['db.statement'] ?? '?'}`);
              if (tags['http.url'])     console.log(`    ${chalk.dim('http:')} ${tags['http.method'] ?? 'GET'} ${tags['http.url']}  status: ${tags['http.status_code'] ?? '?'}`);
              if (tags['db.time_ms'])   console.log(`    ${chalk.dim('db_time:')} ${fmtMs(Number(tags['db.time_ms']))}`);
              console.log('');
            });
          }
          console.log(hr());
        } else {
          console.log(chalk.dim('  No services found in Jaeger — make sure traces are being sent.\n'));
        }
      }

      // ── AI analysis ──
      if (opts.ai) {
        const spinner3 = ora('AI analyzing bottleneck…').start();
        const context  = JSON.stringify({
          url, avgMs, minMs, maxMs,
          hops: hops.map(h => ({
            from: h.from, to: h.to, pod: h.pod,
            ms: h.ms, usage: h.usage,
            recentLogs: h.logs?.split('\n').slice(-5).join('\n'),
          })),
        }, null, 2);

        try {
          const result = await analyze(context, SYSTEM_PROMPT, () => ({
            tool: 'trace', severity: avgMs > 1000 ? 'critical' : avgMs > 300 ? 'warning' : 'info',
            summary: `Request to ${url} averaged ${avgMs}ms.`,
            bottleneck: slowest?.to ?? 'unknown',
            rootCause: 'Add --ai with a Groq key for detailed analysis.',
            fixSteps: '1. Run nxs config --setup to add a free Groq key.',
            commands: `kubectl logs ${slowest?.pod ?? '<pod>'} -n ${ns ?? 'default'}`,
          }));
          spinner3.stop();

          console.log(chalk.bold('\n  AI verdict:\n'));
          console.log(`  ${chalk.yellow('Bottleneck:')} ${chalk.white.bold(result.bottleneck ?? 'unknown')}\n`);
          console.log(`  ${chalk.bold('Summary:')} ${chalk.hex('#94a3b8')(result.summary)}\n`);
          if (result.rootCause) {
            console.log(chalk.bold('  Root cause:\n'));
            result.rootCause.split('\n').forEach(l => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
          if (result.fixSteps) {
            console.log(chalk.bold('\n  Fix steps:\n'));
            result.fixSteps.split('\n').forEach(l => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
          }
          if (result.commands) {
            console.log(chalk.bold('\n  Commands:\n'));
            result.commands.split('\n').forEach(l => console.log(`  ${chalk.cyan(l)}`));
          }
        } catch {
          spinner3.stop();
          console.log(chalk.dim('  AI unavailable.\n'));
        }
        console.log('\n' + hr() + '\n');
      } else {
        console.log(chalk.dim('\n  Tip: add --ai for bottleneck analysis\n'));
      }
    });
}
