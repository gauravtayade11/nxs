/**
 * Shared command runner — handles input, analysis, chat loop.
 * Each tool module calls this with its own systemPrompt + mockFn.
 */
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { createInterface }          from 'node:readline';
import { resolve }                  from 'node:path';
import chalk                        from 'chalk';
import ora                          from 'ora';
import { analyze, chat }            from './ai.js';
import { addHistory }               from './config.js';
import { printResult, readStdin, prompt } from './ui.js';
import { redact, warnIfSensitive }  from './redact.js';

export async function runAnalyze(toolModule, systemPrompt, mockFn, file, opts) {
  let logText = '';

  if (opts._injected) {
    logText = opts._injected;
    if (!opts.json) console.log(chalk.dim(`  Input: auto-fetched (${logText.length} chars)\n`));

  } else if (opts.stdin || (!process.stdin.isTTY && !opts.interactive && !file)) {
    logText = await readStdin();
    if (!logText.trim()) { console.error(chalk.red('  No input from stdin.')); process.exit(1); }
    if (!opts.json) console.log(chalk.dim(`  Input: stdin (${logText.length} chars)\n`));

  } else if (opts.interactive) {
    console.log(chalk.dim('  Paste your log. Type END on a new line when done:\n'));
    const lines = [];
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((res) => {
      rl.on('line', (l) => { if (l.trim() === 'END') { rl.close(); res(); } else lines.push(l); });
    });
    logText = lines.join('\n');
    if (!logText.trim()) { console.error(chalk.red('  No log entered.')); process.exit(1); }

  } else if (file) {
    const fp = resolve(process.cwd(), file);
    if (!existsSync(fp)) { console.error(chalk.red(`  File not found: ${fp}`)); process.exit(1); }
    const stat = statSync(fp);
    if (stat.size === 0) { console.error(chalk.red(`  File is empty: ${fp}`)); process.exit(1); }
    if (stat.size > 512 * 1024) { // 512KB hard limit
      console.error(chalk.red(`  File too large (${Math.round(stat.size / 1024)}KB). Max 512KB.`));
      process.exit(1);
    }
    logText = readFileSync(fp, 'utf8');
    // Strip non-printable binary characters
    // eslint-disable-next-line no-control-regex
    logText = logText.replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '');
    if (!opts.json) console.log(chalk.dim(`  Input: ${fp} (${logText.length} chars)\n`));

  } else {
    console.error(chalk.red('  Provide a file, --stdin, or --interactive.\n'));
    process.exit(1);
  }

  // Passive security warning — shown even without --redact
  const warnings = warnIfSensitive(logText);
  if (warnings.length > 0 && !opts.json) {
    console.log(chalk.yellow('  ⚠  Security notice:'));
    warnings.forEach((w) => console.log(chalk.yellow(`     · ${w}`)));
    console.log(chalk.dim('     Use --redact to scrub sensitive values before sending to AI.\n'));
  }

  // Redact if requested
  if (opts.redact) {
    const { redacted, count, types } = redact(logText);
    logText = redacted;
    if (!opts.json && count > 0) {
      console.log(chalk.green(`  ✓ Redacted ${count} sensitive pattern type(s): ${types.join(', ')}\n`));
    }
  }

  if (opts.json) {
    const result = await analyze(logText, systemPrompt, mockFn);
    console.log(JSON.stringify(result, null, 2));
    // --notify still runs in JSON mode (e.g. CI workflows)
    if (opts.notify === 'slack') {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) await notifySlack(result, toolModule, webhookUrl).catch(() => {});
    }
    return;
  }

  const spinner = ora({ text: 'Analyzing...', color: 'cyan' }).start();

  // Clean Ctrl+C during analysis
  const onSigint = () => { spinner.stop(); console.log('\n' + chalk.dim('  Interrupted.\n')); process.exit(0); };
  process.once('SIGINT', onSigint);

  let result;
  try {
    result = await analyze(logText, systemPrompt, mockFn);
    spinner.succeed(chalk.green('Analysis complete'));
  } catch (err) {
    spinner.fail(chalk.red(`Analysis failed: ${err.message}`));
    if (err.message?.includes('ENOTFOUND') || err.message?.includes('fetch failed')) {
      console.error(chalk.dim('  Check your network connection or try again later.\n'));
    } else if (err.message?.includes('401') || err.message?.includes('invalid_api_key')) {
      console.error(chalk.dim('  Invalid API key. Run: nxs config --setup\n'));
    }
    process.off('SIGINT', onSigint);
    process.exit(1);
  }
  process.off('SIGINT', onSigint);

  addHistory(toolModule, logText, result);
  printResult(result);

  // --notify slack: post result to Slack webhook
  if (opts.notify === 'slack') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log(chalk.yellow('  ⚠ SLACK_WEBHOOK_URL not set. Add to .env:\n    SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...\n'));
    } else {
      try {
        await notifySlack(result, toolModule, webhookUrl);
        console.log(chalk.green('  ✓ Slack notified\n'));
      } catch (e) {
        console.log(chalk.yellow(`  ⚠ Slack notify failed: ${e.message}\n`));
      }
    }
  }

  // --output: save full analysis to a markdown file
  if (opts.output) {
    try {
      const md = buildMarkdown(result, logText);
      writeFileSync(opts.output, md, 'utf8');
      console.log(chalk.green(`  ✓ Analysis saved to ${opts.output}\n`));
    } catch (e) {
      console.error(chalk.red(`  ✗ Could not write output file: ${e.message}\n`));
    }
  }

  // --fail-on: exit 1 if severity matches
  if (opts.failOn && result.severity === opts.failOn) {
    console.log(chalk.red(`  ✗ Severity is '${result.severity}' — exiting with code 1 (--fail-on ${opts.failOn})\n`));
    process.exit(1);
  }

  if (opts.chat !== false) {
    await runChatLoop(logText, result);
  }

  console.log(chalk.dim('  Goodbye.\n'));
}

export async function runHistory(toolModule, opts) {
  const { loadHistory, saveHistory } = await import('./config.js');

  if (opts.clear) {
    // Clear only this tool's history
    const all = loadHistory();
    saveHistory(all.filter((e) => e.toolModule !== toolModule));
    console.log(chalk.green(`  ✓ ${toolModule} history cleared.\n`));
    return;
  }

  const entries = loadHistory(toolModule).slice(0, parseInt(opts.limit ?? '10', 10));
  const { TOOL_COLORS, TOOL_ICONS, hr } = await import('./ui.js');

  if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }

  if (entries.length === 0) {
    console.log(chalk.dim(`  No history yet for ${toolModule}.\n`));
    return;
  }

  console.log(chalk.bold(`  Last ${entries.length} ${toolModule} analyses:\n`));
  console.log(hr());

  entries.forEach((e, i) => {
    const color = TOOL_COLORS[e.tool] ?? chalk.white;
    const icon  = TOOL_ICONS[e.tool]  ?? '⚙  ';
    const date  = new Date(e.timestamp).toLocaleString();
    console.log(`\n  ${chalk.dim(`${i + 1}.`)} ${color.bold(icon + (e.tool ?? 'unknown').toUpperCase())}  ${chalk.dim(date)}`);
    console.log(`     ${chalk.hex('#94a3b8')(e.summary)}`);
    if (e.logPreview) console.log(`     ${chalk.dim(e.logPreview.replace(/\n/g, ' ').slice(0, 80) + '…')}`);
  });

  console.log('\n' + hr() + '\n');
}

async function notifySlack(result, toolModule, webhookUrl) {
  const sev = result.severity ?? 'unknown';
  const sevEmoji = { critical: '🔴', warning: '🟡', info: '🟢' }[sev] ?? '⚪';
  const sevColor = { critical: '#e74c3c', warning: '#f39c12', info: '#2ecc71' }[sev] ?? '#95a5a6';

  const body = {
    attachments: [{
      color: sevColor,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `${sevEmoji} nxs ${toolModule.toUpperCase()} — ${sev.toUpperCase()}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${String(result.summary ?? '').slice(0, 500)}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Root Cause*\n${String(result.rootCause ?? '').slice(0, 500)}` } },
        ...(result.commands ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Fix Commands*\n\`\`\`${String(result.commands).slice(0, 400)}\`\`\`` },
        }] : []),
        ...(result._mock ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `⚠ No AI key — showing extracted log details. Add GROQ_API_KEY for full diagnosis.` }] }] : []),
        { type: 'context', elements: [{ type: 'mrkdwn', text: `nxs CLI · ${new Date().toISOString()}` }] },
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

function buildMarkdown(result, logText) {
  const ts = new Date().toISOString();
  const toMd = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.filter((x) => x && typeof x !== 'number').map((x, i) => `${i + 1}. ${x}`).join('\n');
    return String(v ?? '');
  };
  return `# nxs Analysis — ${(result.tool ?? 'unknown').toUpperCase()}

**Date:** ${ts}
**Severity:** ${result.severity ?? 'unknown'}
${result.resource ? `**Resource:** ${result.resource}  ` : ''}
${result.namespace && result.namespace !== 'unknown' ? `**Namespace:** ${result.namespace}  ` : ''}

## Summary

${toMd(result.summary)}

## Root Cause

${toMd(result.rootCause)}

## Fix Steps

${toMd(result.fixSteps)}

## Remediation Commands

\`\`\`bash
${toMd(result.commands)}
\`\`\`

## Log Input (excerpt)

\`\`\`
${logText.slice(0, 2000)}${logText.length > 2000 ? '\n... (truncated)' : ''}
\`\`\`
`;
}

async function runChatLoop(logText, result) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const history = [];

  console.log(chalk.dim('  💬 Ask a follow-up question (or press Enter to exit):\n'));

  while (true) {
    const q = await prompt(rl, chalk.cyan('  You › '));
    if (!q.trim()) break;

    history.push({ role: 'user', content: q });
    const spin = ora({ text: 'Thinking...', color: 'cyan' }).start();
    try {
      const answer = await chat(logText, result, history);
      spin.stop();
      history.push({ role: 'assistant', content: answer });
      console.log('\n' + chalk.dim('  AI › ') + chalk.white(answer.replace(/\n/g, '\n       ')) + '\n');
    } catch (err) {
      spin.fail(chalk.red(`Error: ${err.message}`));
    }
  }

  rl.close();
}
