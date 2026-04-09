/**
 * nxs serve — REST API server for team and CI/CD integration
 *
 * Endpoints:
 *   GET  /health                  → health check
 *   GET  /info                    → version, tools, history count
 *   POST /analyze                 → { tool, log } → analysis JSON
 *   GET  /history                 → ?tool=k8s&limit=20
 *   DELETE /history               → clear all history
 *   POST /webhook/alertmanager    → Prometheus Alertmanager → analyze → Slack
 *   POST /webhook/github          → GitHub Actions failure → analyze → Slack
 *   GET  /report                  → ?days=7 → markdown digest
 */
import { createServer } from 'node:http';
import chalk from 'chalk';
import { analyze } from '../core/ai.js';
import { loadHistory, addHistory, saveHistory } from '../core/config.js';
import { printBanner, VERSION } from '../core/ui.js';

// ── API system prompts (lean versions for programmatic use) ──────────────────

const TOOL_PROMPTS = {
  devops: `You are an expert DevOps engineer. Analyze the CI/CD, Docker, or Terraform log.
Return JSON: { "tool":"<docker|terraform|ci|unknown>","severity":"<critical|warning|info>","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,

  k8s: `You are a Kubernetes expert (CKA level). Analyze the Kubernetes log or event output.
Return JSON: { "tool":"kubernetes","severity":"<critical|warning|info>","resource":"<Pod|Deployment|...>","namespace":"<ns>","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,

  sec: `You are a senior AppSec engineer. Analyze the security scan output (Trivy, Grype, Snyk, OWASP).
Return JSON: { "tool":"<trivy|grype|snyk|owasp|unknown>","severity":"<critical|warning|info>","scanner":"...","target":"...","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,

  net: `You are a senior network engineer. Analyze the network or connectivity error.
Return JSON: { "tool":"network","severity":"<critical|warning|info>","errorType":"<dns|tls|timeout|http|unknown>","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,

  db: `You are an expert DBA. Analyze the database error or log.
Return JSON: { "tool":"<postgresql|mysql|mongodb|redis|unknown>","severity":"<critical|warning|info>","errorCode":"...","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,

  ci: `You are a senior CI/CD engineer. Analyze the pipeline failure log.
Return JSON: { "tool":"<github-actions|gitlab-ci|jenkins|circleci|unknown>","severity":"<critical|warning|info>","pipeline":"...","step":"...","summary":"...","rootCause":"...","fixSteps":"...","commands":"..." }
Return ONLY valid JSON. No markdown.`,
};

const VALID_TOOLS = Object.keys(TOOL_PROMPTS);
const startTime = Date.now();

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function send(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const type = typeof data === 'string' ? 'text/plain' : 'application/json';
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
  });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2 * 1024 * 1024) reject(new Error('Body too large (max 2MB)')); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function log(method, path, status, ms) {
  const col = status < 300 ? chalk.green : status < 400 ? chalk.yellow : chalk.red;
  console.log(`  ${chalk.dim(new Date().toISOString())}  ${chalk.cyan(method.padEnd(6))} ${path.padEnd(35)} ${col(status)}  ${chalk.dim(ms + 'ms')}`);
}

// ── Route handlers ───────────────────────────────────────────────────────────

function handleHealth(req, res) {
  send(res, 200, {
    status: 'ok',
    version: VERSION,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
}

function handleInfo(req, res) {
  const history = loadHistory();
  send(res, 200, {
    name: 'nxs-cli API',
    version: VERSION,
    tools: VALID_TOOLS,
    history_count: history.length,
    docs: 'POST /analyze  |  GET /history  |  POST /webhook/alertmanager  |  POST /webhook/github  |  GET /report',
  });
}

async function handleAnalyze(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { send(res, 400, { error: e.message }); return; }

  const { tool, log: logText } = body;

  if (!logText?.trim()) { send(res, 400, { error: 'Missing required field: log' }); return; }

  const toolKey = (tool ?? 'devops').toLowerCase();
  const prompt = TOOL_PROMPTS[toolKey];
  if (!prompt) {
    send(res, 400, { error: `Unknown tool: ${toolKey}. Valid: ${VALID_TOOLS.join(', ')}` });
    return;
  }

  try {
    const result = await analyze(logText, prompt, () => ({
      tool: toolKey, severity: 'info',
      summary: 'Mock analysis — set GROQ_API_KEY or ANTHROPIC_API_KEY for real analysis.',
      rootCause: 'No AI provider configured.', fixSteps: 'Run: nxs config --setup', commands: '',
    }));

    addHistory(toolKey, logText, result);
    send(res, 200, result);
  } catch (e) {
    send(res, 500, { error: 'Analysis failed', detail: e.message });
  }
}

function handleHistory(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const toolFilter = url.searchParams.get('tool');
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10), 200);

  let entries = loadHistory();
  if (toolFilter) entries = entries.filter((e) => e.toolModule === toolFilter || e.tool === toolFilter);
  entries = entries.slice(0, limit);

  send(res, 200, { count: entries.length, entries });
}

function handleHistoryClear(req, res) {
  saveHistory([]);
  send(res, 200, { message: 'History cleared.' });
}

async function handleAlertmanager(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { send(res, 400, { error: e.message }); return; }

  const alerts = body.alerts ?? [];
  if (alerts.length === 0) { send(res, 200, { message: 'No alerts to process.' }); return; }

  const results = [];

  for (const alert of alerts.slice(0, 5)) { // cap at 5 per webhook call
    const labels = alert.labels ?? {};
    const annotations = alert.annotations ?? {};

    // Build a log-like text from the alert fields
    const logText = [
      `Alert: ${labels.alertname ?? 'unknown'}`,
      `Status: ${alert.status ?? 'firing'}`,
      `Severity: ${labels.severity ?? 'unknown'}`,
      `Namespace: ${labels.namespace ?? 'unknown'}`,
      `Pod: ${labels.pod ?? labels.instance ?? 'unknown'}`,
      `Summary: ${annotations.summary ?? ''}`,
      `Description: ${annotations.description ?? ''}`,
      `Starts: ${alert.startsAt ?? ''}`,
    ].filter(Boolean).join('\n');

    // Route to best-fit tool
    const toolKey = labels.alertname?.toLowerCase().includes('pod') || labels.alertname?.toLowerCase().includes('kube')
      ? 'k8s'
      : labels.alertname?.toLowerCase().includes('db') || labels.alertname?.toLowerCase().includes('postgres')
        ? 'db'
        : 'devops';

    try {
      const result = await analyze(logText, TOOL_PROMPTS[toolKey], () => ({
        tool: toolKey, severity: 'warning',
        summary: `Alert fired: ${labels.alertname}`,
        rootCause: annotations.description ?? 'No description provided.',
        fixSteps: 'Investigate the alert using the commands below.',
        commands: `kubectl get events -n ${labels.namespace ?? 'default'} --sort-by=.metadata.creationTimestamp`,
      }));

      addHistory(toolKey, logText, result);
      results.push({ alert: labels.alertname, result });

      // Notify Slack if configured
      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl) {
        await postSlack(result, `alertmanager/${labels.alertname}`, slackUrl).catch(() => {});
      }
    } catch (e) {
      results.push({ alert: labels.alertname, error: e.message });
    }
  }

  send(res, 200, { processed: results.length, results });
}

async function handleGithubWebhook(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { send(res, 400, { error: e.message }); return; }

  const event = req.headers['x-github-event'];

  // Only care about workflow_run completions that failed
  if (event !== 'workflow_run' || body.action !== 'completed') {
    send(res, 200, { message: `Ignored: ${event}/${body.action ?? 'unknown'}` });
    return;
  }

  const run = body.workflow_run ?? {};
  if (run.conclusion !== 'failure') {
    send(res, 200, { message: `Run ${run.id} concluded: ${run.conclusion} — no action needed.` });
    return;
  }

  // Build a synthetic log from the workflow_run payload
  const logText = [
    `GitHub Actions workflow failed`,
    `Workflow: ${run.name}`,
    `Run ID: ${run.id}`,
    `Branch: ${run.head_branch}`,
    `Commit: ${run.head_sha?.slice(0, 8)}`,
    `Triggered by: ${run.triggering_actor?.login ?? 'unknown'}`,
    `Run URL: ${run.html_url}`,
    `Failed jobs: ${(run.jobs_url ?? '')}`,
    `Conclusion: ${run.conclusion}`,
    `Started: ${run.run_started_at}`,
  ].join('\n');

  const CI_PROMPT = TOOL_PROMPTS.ci;

  try {
    const result = await analyze(logText, CI_PROMPT, () => ({
      tool: 'github-actions', severity: 'critical',
      pipeline: run.name,
      step: 'unknown — see run URL',
      summary: `GitHub Actions workflow "${run.name}" failed on branch ${run.head_branch}.`,
      rootCause: `Run ${run.id} concluded with: ${run.conclusion}. Check the run URL for details.`,
      fixSteps: `1. Open the run: ${run.html_url}\n2. Identify the failed step\n3. Fix and re-push.`,
      commands: `gh run view ${run.id} --log-failed\ngh run rerun ${run.id} --failed`,
    }));

    addHistory('ci', logText, result);

    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      await postSlack(result, `github-actions/${run.name}`, slackUrl, run.html_url).catch(() => {});
    }

    send(res, 200, { processed: 1, run_id: run.id, result });
  } catch (e) {
    send(res, 500, { error: 'Analysis failed', detail: e.message });
  }
}

function handleReport(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Number.parseInt(url.searchParams.get('days') ?? '7', 10), 90);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const entries = loadHistory().filter((e) => new Date(e.timestamp).getTime() > since);
  const md = buildReport(entries, days);
  send(res, 200, md);
}

// ── Report builder ───────────────────────────────────────────────────────────

function buildReport(entries, days) {
  const now = new Date().toISOString().split('T')[0];
  const counts = { critical: 0, warning: 0, info: 0 };
  const byTool = {};

  for (const e of entries) {
    const sev = e.severity ?? 'info';
    counts[sev] = (counts[sev] ?? 0) + 1;
    const mod = e.toolModule ?? 'unknown';
    if (!byTool[mod]) byTool[mod] = { total: 0, critical: 0, warning: 0 };
    byTool[mod].total++;
    if (sev === 'critical') byTool[mod].critical++;
    if (sev === 'warning') byTool[mod].warning++;
  }

  const critical = entries.filter((e) => e.severity === 'critical').slice(0, 5);

  const lines = [
    `# nxs Report — Last ${days} days (${now})`,
    '',
    `**Total analyses:** ${entries.length}  |  🔴 Critical: ${counts.critical}  |  🟡 Warning: ${counts.warning}  |  🟢 Info: ${counts.info}`,
    '',
    '## By Tool',
    '',
    '| Tool | Total | Critical | Warning |',
    '|------|-------|----------|---------|',
    ...Object.entries(byTool).sort((a, b) => b[1].critical - a[1].critical)
      .map(([tool, s]) => `| ${tool} | ${s.total} | ${s.critical > 0 ? `🔴 ${s.critical}` : s.critical} | ${s.warning} |`),
    '',
    '## Top Critical Issues',
    '',
    ...critical.flatMap((e) => [
      `### ${e.tool ?? e.toolModule ?? 'unknown'} — ${new Date(e.timestamp).toLocaleString()}`,
      `${e.summary ?? ''}`,
      '',
    ]),
    entries.length === 0 ? '_No analyses in this period._' : '',
  ];

  return lines.join('\n');
}

// ── Slack helper ─────────────────────────────────────────────────────────────

async function postSlack(result, source, webhookUrl, runUrl = null) {
  const sev = result.severity ?? 'unknown';
  const sevEmoji = { critical: '🔴', warning: '🟡', info: '🟢' }[sev] ?? '⚪';
  const sevColor = { critical: '#e74c3c', warning: '#f39c12', info: '#2ecc71' }[sev] ?? '#95a5a6';

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachments: [{
        color: sevColor,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `${sevEmoji} nxs ${source.toUpperCase()} — ${sev.toUpperCase()}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${String(result.summary ?? '').slice(0, 500)}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Root Cause*\n${String(result.rootCause ?? '').slice(0, 500)}` } },
          ...(result.commands ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Fix Commands*\n\`\`\`${String(result.commands).slice(0, 400)}\`\`\`` } }] : []),
          ...(runUrl ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Run URL*\n${runUrl}` } }] : []),
          ...(result._mock ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `⚠ No AI key — showing extracted log details. Add GROQ_API_KEY for full diagnosis.` } ] }] : []),
          { type: 'context', elements: [{ type: 'mrkdwn', text: `nxs serve · ${new Date().toISOString()}` }] },
        ],
      }],
    }),
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

export function registerServe(program) {
  program
    .command('serve')
    .description('Start the nxs REST API server for team and CI/CD integration')
    .option('-p, --port <n>', 'Port to listen on (default: 4000)', '4000')
    .option('--host <host>', 'Host to bind to (default: 0.0.0.0)', '0.0.0.0')
    .addHelpText('after', `
Auth:
  Set NXS_API_KEY env var to require X-Api-Key header on all requests.
  /health and /webhook/* are always public.
  curl example: curl -H "X-Api-Key: $NXS_API_KEY" http://localhost:4000/analyze

Endpoints:
  GET  /health                   Health check (no auth)
  GET  /info                     Version, tools, history count
  POST /analyze                  Analyze a log  { tool, log }
  GET  /history                  Past analyses  ?tool=k8s&limit=20
  DELETE /history                Clear all history
  POST /webhook/alertmanager     Prometheus Alertmanager → analyze → Slack
  POST /webhook/github           GitHub Actions failure → analyze → Slack
  GET  /report                   Digest  ?days=7

GitHub Actions — auto-notify on failure (add to .github/workflows/ci.yml):
  notify-failure:
    needs: [lint, smoke-test]
    if: failure()
    steps:
      - run: |
          gh run view \${{ github.run_id }} --log-failed | \\
          node cli/index.js ci analyze --stdin --notify slack --no-chat --json
        env:
          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}
          GROQ_API_KEY: \${{ secrets.GROQ_API_KEY }}
          GH_TOKEN: \${{ github.token }}

GitHub webhook (Settings → Webhooks → add):
  Payload URL:  http://<your-nxs-server>:4000/webhook/github
  Content type: application/json
  Events:       Workflow runs

Alertmanager config:
  receivers:
    - name: nxs
      webhook_configs:
        - url: http://nxs:4000/webhook/alertmanager`)
    .action(async (opts) => {
      printBanner('API server');

      const port = Number.parseInt(opts.port, 10);
      const host = opts.host;

      const server = createServer(async (req, res) => {
        const t0 = Date.now();

        // CORS preflight
        if (req.method === 'OPTIONS') {
          send(res, 204, '');
          return;
        }

        const path = req.url.split('?')[0];
        const method = req.method;

        // Auth check — skip for /health and webhooks (they use their own secrets)
        const apiKey = process.env.NXS_API_KEY;
        const publicPaths = ['/health', '/webhook/alertmanager', '/webhook/github'];
        if (apiKey && !publicPaths.includes(path)) {
          const provided = req.headers['x-api-key'] ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
          if (provided !== apiKey) {
            send(res, 401, { error: 'Unauthorized. Provide your NXS_API_KEY via X-Api-Key header.' });
            log(method, req.url, 401, Date.now() - t0);
            return;
          }
        }

        try {
          if (method === 'GET'    && path === '/health')              { handleHealth(req, res); }
          else if (method === 'GET'    && path === '/info')           { handleInfo(req, res); }
          else if (method === 'POST'   && path === '/analyze')        { await handleAnalyze(req, res); }
          else if (method === 'GET'    && path === '/history')        { handleHistory(req, res); }
          else if (method === 'DELETE' && path === '/history')        { await handleHistoryClear(req, res); }
          else if (method === 'POST'   && path === '/webhook/alertmanager') { await handleAlertmanager(req, res); }
          else if (method === 'POST'   && path === '/webhook/github')       { await handleGithubWebhook(req, res); }
          else if (method === 'GET'    && path === '/report')         { handleReport(req, res); }
          else { send(res, 404, { error: `No route: ${method} ${path}` }); }
        } catch (e) {
          send(res, 500, { error: 'Internal server error', detail: e.message });
        }

        log(method, req.url, res.statusCode, Date.now() - t0);
      });

      server.listen(port, host, () => {
        console.log(chalk.bold(`\n  ⚡ nxs API server running\n`));
        console.log(`  ${chalk.green('●')} ${chalk.white(`http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)}`);
        console.log(chalk.dim(`\n  Endpoints:\n`));
        const endpoints = [
          ['GET',    '/health',                 'Health check'],
          ['GET',    '/info',                   'Version + tool list'],
          ['POST',   '/analyze',                '{ tool, log } → analysis JSON'],
          ['GET',    '/history',                'Past analyses  ?tool=k8s&limit=20'],
          ['DELETE', '/history',                'Clear all history'],
          ['POST',   '/webhook/alertmanager',   'Prometheus Alertmanager → analyze → Slack'],
          ['POST',   '/webhook/github',         'GitHub Actions failure → analyze → Slack'],
          ['GET',    '/report',                 'Digest  ?days=7'],
        ];
        endpoints.forEach(([m, p, d]) => {
          const col = { GET: chalk.green, POST: chalk.yellow, DELETE: chalk.red }[m] ?? chalk.white;
          console.log(`  ${col(m.padEnd(7))} ${chalk.cyan(p.padEnd(30))} ${chalk.dim(d)}`);
        });
        console.log();
        if (process.env.NXS_API_KEY) {
          console.log(chalk.green('  ✓ Auth enabled  ') + chalk.dim('(X-Api-Key header required)'));
        } else {
          console.log(chalk.yellow('  ⚠ No auth  ') + chalk.dim('Set NXS_API_KEY to protect the API'));
        }
        if (process.env.SLACK_WEBHOOK_URL) {
          console.log(chalk.green('  ✓ Slack webhook configured'));
        } else {
          console.log(chalk.dim('  Tip: set SLACK_WEBHOOK_URL to auto-notify on alertmanager events'));
        }
        console.log(chalk.dim('\n  Press Ctrl+C to stop\n'));
      });

      process.once('SIGINT', () => {
        server.close(() => {
          console.log(chalk.dim('\n  Server stopped.\n'));
          process.exit(0);
        });
      });
    });
}
