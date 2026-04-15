/**
 * nxs watch — tail a log file or live command, auto-analyze errors as they appear
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { printBanner, hr } from '../core/ui.js';
import { analyze } from '../core/ai.js';
import { printResult } from '../core/ui.js';
import { warnIfSensitive, redact as redactText } from '../core/redact.js';

const WATCH_SYSTEM_PROMPT = `You are a senior DevOps engineer doing real-time incident response. Analyze this log excerpt that contains one or more errors.

Return a JSON object with exactly this structure:

{
  "tool": "watch",
  "severity": "<critical|warning|info>",
  "summary": "<1 sentence: what just failed and which service/component is affected>",
  "rootCause": "<what caused this specific error — be precise about the failing line>",
  "fixSteps": "<immediate actions — this is live incident response, be brief and actionable>",
  "commands": "<exact commands to run RIGHT NOW to investigate or mitigate>"
}

Severity:
- critical: service down, data loss risk, OOM kill, segfault, panic, authentication failure
- warning: elevated error rate, retry storms, degraded performance, connection pool pressure
- info: expected errors, health check failures, cache misses, rate limit warnings

Focus on the MOST RECENT error. Be brief — this is real-time.

Return ONLY valid JSON. No markdown fences.`;

// ── Severity classification ──────────────────────────────────────────────────
const CRITICAL_PATTERNS = [
  /\b(FATAL|CRITICAL|PANIC)\b/,
  /\b(OOMKilled|segfault)\b/i,
  /panic:/i,
  /out of memory/i,
  /\bkilled\b.*\bsignal\b/i,
];

const WARNING_PATTERNS = [
  /\b(ERROR|EXCEPTION|FAILED|BUILD FAILURE)\b/,
  /exit(?:ed)?(?: with)?(?: code)? [1-9]/i,
  /\b(CrashLoopBackOff|ImagePullBackOff|ErrImagePull)\b/,
  /\bException\b/,
  /Traceback \(most recent call last\)/,
  /\b(timeout|timed out|connection refused|connection reset)\b/i,
];

function classifySeverity(line) {
  if (CRITICAL_PATTERNS.some(p => p.test(line))) return 'critical';
  if (WARNING_PATTERNS.some(p  => p.test(line))) return 'warning';
  return null;
}


const SEV_RANK = { critical: 2, warning: 1, info: 0 };

function meetsThreshold(lineSeverity, filterSeverity) {
  return SEV_RANK[lineSeverity] >= SEV_RANK[filterSeverity ?? 'warning'];
}

function mockAnalyze() {
  return {
    tool: 'watch', severity: 'warning',
    summary: 'Error detected in log stream — review the highlighted line for root cause.',
    rootCause: 'An error pattern was detected. Check the specific line above for the actual cause.',
    fixSteps: '1. Review the full error context above\n2. Check upstream dependencies\n3. Look for resource exhaustion (CPU, memory, connections)',
    commands: 'kubectl get events --sort-by=.metadata.creationTimestamp\ntail -100 /var/log/app/error.log\njournalctl -u <service> -n 50',
  };
}

export function registerWatch(program) {
  program
    .command('watch <source>')
    .description('Tail a log file or live command — auto-analyze errors as they appear')
    .option('--interval <s>', 'File poll interval in seconds (default: 2)', '2')
    .option('--cooldown <s>', 'Min seconds between AI analyses to avoid spam (default: 30)', '30')
    .option('--context <n>', 'Lines of context to include per error analysis (default: 40)', '40')
    .option('--severity <level>', 'Minimum severity to trigger AI: critical|warning (default: warning)', 'warning')
    .option('--notify <target>', 'Alert target after each analysis: slack')
    .option('--redact', 'Scrub secrets/tokens from log lines before sending to AI')
    .addHelpText('after', `
<source> is a log file path OR a shell command (wrap commands in quotes):

Examples:
  $ nxs watch app.log
  $ nxs watch /var/log/nginx/error.log
  $ nxs watch "kubectl logs -f my-pod -n production"
  $ nxs watch "docker logs -f my-container"
  $ nxs watch app.log --notify slack
  $ nxs watch app.log --cooldown 60 --context 80
  $ nxs watch app.log --severity critical          # only trigger AI on FATAL/PANIC/OOM
  $ nxs watch "kubectl logs -f deploy/api" --notify slack`)
    .action(async (source, opts) => {
      printBanner('Live log watcher');

      const cooldown    = Math.max(5, Number.parseInt(opts.cooldown, 10) || 30) * 1000;
      const ctxLines    = Math.max(10, Number.parseInt(opts.context, 10) || 40);
      const interval    = Math.max(1, Number.parseInt(opts.interval, 10) || 2) * 1000;
      const minSeverity = ['critical', 'warning'].includes(opts.severity) ? opts.severity : 'warning';

      if (!opts.json) {
        const sevLabel = minSeverity === 'critical'
          ? chalk.red('critical only')
          : chalk.yellow('warning+');
        console.log(chalk.dim(`  Severity filter: ${sevLabel}\n`));
      }

      // Validate Slack config
      let slackUrl = null;
      if (opts.notify === 'slack') {
        slackUrl = process.env.SLACK_WEBHOOK_URL;
        if (slackUrl) {
          console.log(chalk.green('  ✓ Slack notifications enabled\n'));
        } else {
          console.log(chalk.yellow('  ⚠ SLACK_WEBHOOK_URL not set — Slack notifications disabled'));
          console.log(chalk.dim('    Add to .env: SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...\n'));
        }
      }

      const shouldRedact = !!opts.redact;

      // File vs command detection
      const fp = resolve(process.cwd(), source);
      const isFile = existsSync(fp);

      if (isFile) {
        await watchFile(fp, { interval, cooldown, ctxLines, slackUrl, minSeverity, shouldRedact });
      } else {
        // Treat as shell command
        await watchCommand(source, { cooldown, ctxLines, slackUrl, minSeverity, shouldRedact });
      }
    });
}

// ── File watcher ────────────────────────────────────────────────────────────

async function watchFile(fp, { interval, cooldown, ctxLines, slackUrl, minSeverity, shouldRedact }) {
  let lastSize = statSync(fp).size;
  let lastAnalysis = 0;
  const buffer = [];

  console.log(chalk.dim(`  File:     ${chalk.white(fp)}`));
  console.log(chalk.dim(`  Polling:  every ${interval / 1000}s  |  Cooldown: ${cooldown / 1000}s`));
  console.log(chalk.dim(`  Context:  ${ctxLines} lines per error\n`));
  console.log(chalk.dim('  Watching for new errors... (Ctrl+C to stop)\n'));
  console.log(hr());

  const check = async () => {
    try {
      const stat = statSync(fp);
      if (stat.size <= lastSize) return; // nothing new

      const newContent = readFileSync(fp, 'utf8').slice(lastSize);
      lastSize = stat.size;

      const newLines = newContent.split('\n').filter(Boolean);
      buffer.push(...newLines);
      if (buffer.length > 500) buffer.splice(0, buffer.length - 500);

      // Only consider lines that meet the severity threshold
      const errorLines = newLines.filter(l => {
        const sev = classifySeverity(l);
        return sev !== null && meetsThreshold(sev, minSeverity);
      });
      if (errorLines.length === 0) return;

      // Cooldown check
      const remaining = Math.ceil((cooldown - (Date.now() - lastAnalysis)) / 1000);
      if (Date.now() - lastAnalysis < cooldown) {
        const sev = classifySeverity(errorLines[0]);
        console.log(chalk.dim(`  [${new Date().toLocaleTimeString()}] ${sev?.toUpperCase() ?? 'ERROR'} detected (cooldown: ${remaining}s remaining)`));
        return;
      }

      lastAnalysis = Date.now();
      await triggerAnalysis(buffer.slice(-ctxLines), errorLines, slackUrl, shouldRedact);
    } catch { /* file rotation / access error — keep watching */ }
  };

  const timer = setInterval(check, interval);
  process.once('SIGINT', () => {
    clearInterval(timer);
    console.log('\n' + chalk.dim('  Watch stopped.\n'));
    process.exit(0);
  });
}

// ── Command watcher ─────────────────────────────────────────────────────────

async function watchCommand(source, { cooldown, ctxLines, slackUrl, minSeverity, shouldRedact }) {
  console.log(chalk.dim(`  Command:  ${chalk.white(source)}`));
  console.log(chalk.dim(`  Cooldown: ${cooldown / 1000}s between analyses`));
  console.log(chalk.dim(`  Context:  ${ctxLines} lines\n`));
  console.log(chalk.dim('  Streaming output... (Ctrl+C to stop)\n'));
  console.log(hr() + '\n');

  const buffer = [];
  let lastAnalysis = 0;
  let pending = '';

  const child = spawn('sh', ['-c', source], { stdio: ['ignore', 'pipe', 'pipe'] });

  const processLine = async (line) => {
    if (!line.trim()) return;
    // Show the live output (dim)
    const lineSev = classifySeverity(line);
    let lineColor = chalk.dim;
    if (lineSev === 'critical') lineColor = chalk.red;
    else if (lineSev === 'warning') lineColor = chalk.yellow;
    console.log(lineColor('  ' + line.slice(0, 140)));
    buffer.push(line);
    if (buffer.length > 500) buffer.shift();

    if (!lineSev || !meetsThreshold(lineSev, minSeverity)) return;
    if (Date.now() - lastAnalysis < cooldown) return;

    lastAnalysis = Date.now();
    await triggerAnalysis(buffer.slice(-ctxLines), [line], slackUrl, shouldRedact);
  };

  const handleChunk = (chunk) => {
    const text = pending + chunk.toString();
    const lines = text.split('\n');
    pending = lines.pop(); // incomplete last line
    lines.forEach(processLine);
  };

  child.stdout.on('data', handleChunk);
  child.stderr.on('data', handleChunk);

  child.on('close', (code) => {
    if (pending.trim()) processLine(pending);
    console.log(chalk.dim(`\n  Command exited (code ${code ?? '?'}).\n`));
    process.exit(0);
  });

  process.once('SIGINT', () => {
    child.kill();
    console.log('\n' + chalk.dim('  Watch stopped.\n'));
    process.exit(0);
  });
}

// ── Shared analysis trigger ──────────────────────────────────────────────────

async function triggerAnalysis(contextBuffer, errorLines, slackUrl, shouldRedact = false) {
  const topSev = errorLines.reduce((max, l) => {
    const s = classifySeverity(l);
    return SEV_RANK[s] > SEV_RANK[max] ? s : max;
  }, 'warning');
  const sevLabel = topSev === 'critical' ? chalk.red.bold('CRITICAL') : chalk.yellow.bold('WARNING');
  console.log(`\n  ${chalk.red('⚡')} ${sevLabel} detected  ${chalk.dim(new Date().toLocaleTimeString())}`);
  errorLines.slice(0, 3).forEach((l) => {
    const sev = classifySeverity(l);
    const col = sev === 'critical' ? chalk.red : chalk.yellow;
    console.log(col('  ▸ ') + chalk.dim(l.slice(0, 140)));
  });
  console.log('');

  let context = contextBuffer.join('\n');

  const warnings = warnIfSensitive(context);
  if (warnings.length > 0) {
    warnings.forEach((w) => console.log(chalk.yellow(`  ⚠  ${w}`)));
    console.log(chalk.dim('     Use --redact to scrub sensitive values before sending to AI.\n'));
  }
  if (shouldRedact) {
    const { redacted, count, types } = redactText(context);
    context = redacted;
    if (count > 0) console.log(chalk.green(`  ✓ Redacted ${count} sensitive pattern type(s): ${types.join(', ')}\n`));
  }

  const spinner = ora({ text: 'Analyzing...', color: 'cyan' }).start();

  try {
    const result = await analyze(context, WATCH_SYSTEM_PROMPT, mockAnalyze);
    spinner.succeed(chalk.green('Analysis complete'));
    printResult(result);

    if (slackUrl) {
      try {
        await postSlack(result, slackUrl);
        console.log(chalk.green('  ✓ Slack notified\n'));
      } catch (e) {
        console.log(chalk.yellow(`  ⚠ Slack notify failed: ${e.message}\n`));
      }
    }
  } catch (err) {
    spinner.fail(chalk.red(`Analysis failed: ${err.message}`));
  }

  console.log(hr());
  console.log(chalk.dim('\n  Resuming watch...\n'));
}

// ── Slack helper (local to watch) ────────────────────────────────────────────

async function postSlack(result, webhookUrl) {
  const sev = result.severity ?? 'unknown';
  const sevEmoji = { critical: '🔴', warning: '🟡', info: '🟢' }[sev] ?? '⚪';
  const sevColor = { critical: '#e74c3c', warning: '#f39c12', info: '#2ecc71' }[sev] ?? '#95a5a6';

  const body = {
    attachments: [{
      color: sevColor,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `${sevEmoji} nxs watch — ${sev.toUpperCase()}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${String(result.summary ?? '').slice(0, 500)}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Root Cause*\n${String(result.rootCause ?? '').slice(0, 500)}` } },
        ...(result.commands ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Fix Now*\n\`\`\`${String(result.commands).slice(0, 400)}\`\`\`` },
        }] : []),
        { type: 'context', elements: [{ type: 'mrkdwn', text: `nxs watch · ${new Date().toISOString()}` }] },
      ],
    }],
  };

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Slack HTTP ${resp.status}`);
}
