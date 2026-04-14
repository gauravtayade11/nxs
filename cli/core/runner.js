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
import { addHistory, getPatternFrequency } from './config.js';
import { printResult, readStdin, prompt } from './ui.js';
import { redact, warnIfSensitive }  from './redact.js';

function substituteContext(result, opts) {
  const pod  = opts.pod        || null;
  const ns   = opts.namespace  || null;
  const dep  = opts.deployment || null;

  if (!pod && !ns && !dep) return;

  // kubectl command to look up the image when we don't know it
  const imageCmd = dep && ns
    ? `$(kubectl get deploy ${dep} -n ${ns} -o jsonpath='{.spec.template.spec.containers[0].image}')`
    : dep
      ? `$(kubectl get deploy ${dep} -o jsonpath='{.spec.template.spec.containers[0].image}')`
      : pod && ns
        ? `$(kubectl get pod ${pod} -n ${ns} -o jsonpath='{.spec.containers[0].image}')`
        : '<image>';

  const subst = (str) => {
    if (typeof str !== 'string') return str;
    if (pod)  str = str.replace(/<pod(-name)?>/g, pod);
    if (ns)   str = str.replace(/<namespace>/g,   ns);
    if (dep)  str = str.replace(/<(deployment(-name)?|name)>/g, dep);
    str = str.replace(/<image(:[^>]*)?>/g, imageCmd);
    // kubectl commands without explicit -n: insert -n before any pipe or end of line.
    // Done line-by-line with indexOf to avoid ReDoS from backtracking quantifiers.
    if (ns) {
      const kubectlCmdRe = /kubectl (?:logs|describe pod|get pod|top pod|exec)\b/;
      str = str.split('\n').map((line) => {
        const match = kubectlCmdRe.exec(line);
        if (!match) return line;
        const pipeIdx = line.indexOf('|', match.index);
        const cmdPart = pipeIdx === -1 ? line.slice(match.index) : line.slice(match.index, pipeIdx);
        if (cmdPart.includes('-n ')) return line;
        if (pipeIdx === -1) return `${line} -n ${ns}`;
        return `${line.slice(0, pipeIdx).trimEnd()} -n ${ns} | ${line.slice(pipeIdx + 1).trimStart()}`;
      }).join('\n');
    }
    return str;
  };

  for (const field of ['commands', 'fixSteps', 'rootCause', 'summary']) {
    if (result[field]) result[field] = subst(result[field]);
  }
}

export async function runAnalyze(toolModule, systemPrompt, mockFn, file, opts) {
  let logText = '';

  if (opts._injected) {
    logText = opts._injected;
    if (!opts.json) console.log(chalk.dim(`  Input: auto-fetched (${logText.length} chars)\n`));

  } else if (opts.stdin || (!process.stdin.isTTY && !opts.interactive && !file)) {
    logText = await readStdin();
    if (!logText.trim()) { console.error(chalk.red('  No input from stdin.')); process.exit(1); }
    if (!opts.json) {
      console.log(chalk.dim(`  Input: stdin (${logText.length} chars)\n`));
      if (logText.length < 200 && toolModule === 'k8s') {
        console.log(chalk.dim('  Tip: for richer analysis with exact pod names, use --pod <name> -n <namespace>\n'));
      }
    }

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
    const result = await analyze(logText, systemPrompt, mockFn, { fast: !!opts.fast });
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

  if (opts.fast && !opts.json) {
    console.log(chalk.dim('  ⚡ Fast mode — using rule engine only (no AI)\n'));
  }

  const t0 = Date.now();
  let result;
  try {
    result = await analyze(logText, systemPrompt, mockFn, { fast: !!opts.fast });
    const via = result.via === 'rules' ? chalk.cyan('rules engine') : result.via === 'ai-groq' ? chalk.green('Groq AI') : result.via === 'ai-anthropic' ? chalk.magenta('Claude AI') : chalk.dim('demo');
    const cacheHit = result._cached ? chalk.dim('  ⚡ cached') : '';
    const latency  = process.env.NXS_DEBUG === '1' ? chalk.dim(`  ${Date.now() - t0}ms`) : '';
    spinner.succeed(chalk.green('Analysis complete') + chalk.dim(`  via ${via}`) + cacheHit + latency);
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

  // Substitute known values into rule-engine placeholders
  substituteContext(result, opts);

  const { _cached, ...resultForHistory } = result;
  addHistory(toolModule, logText, resultForHistory);

  // Pattern frequency — look back 7 days
  const errorTag = result.via === 'rules' && result.id
    ? result.id
    : `${result.tool ?? toolModule}:${result.severity ?? 'info'}`;
  const freq = getPatternFrequency(errorTag, 7);

  printResult(result, freq);

  // AI disclaimer — shown for non-deterministic results only (not cached — those are already stable)
  if ((result.via === 'ai-groq' || result.via === 'ai-anthropic') && !result._cached) {
    console.log(chalk.dim('  ℹ  AI-generated — responses may vary. Verify all commands before running in production.\n'));
  }

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
      // Resolve to absolute path and restrict to cwd to prevent path traversal
      const safePath = resolve(process.cwd(), opts.output);
      if (!safePath.startsWith(process.cwd())) {
        console.error(chalk.red('  ✗ Output path must be within the current directory\n'));
        return result;
      }
      const md = buildMarkdown(result, logText);
      writeFileSync(safePath, md, 'utf8');
      console.log(chalk.green(`  ✓ Analysis saved to ${safePath}\n`));
    } catch (e) {
      console.error(chalk.red(`  ✗ Could not write output file: ${e.message}\n`));
    }
  }

  // --fail-on: exit 1 if severity meets threshold (also via global --fail-on env)
  const failOn = opts.failOn ?? process.env.NXS_FAIL_ON;
  const SEV_ORDER = { info: 0, warning: 1, critical: 2 };
  if (failOn && SEV_ORDER[result.severity] >= (SEV_ORDER[failOn] ?? 99)) {
    console.log(chalk.red(`  ✗ Severity '${result.severity}' meets --fail-on '${failOn}' threshold — exiting with code 1\n`));
    process.exit(1);
  }

  if (opts.chat === true) {
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

function toSlackBullets(v) {
  if (!v) return '_None_';
  const items = Array.isArray(v)
    ? v.map(String).filter(l => l.trim() && !/^\d+$/.test(l.trim()))
    : String(v).split('\n').filter(l => l.trim());
  return items.length ? items.map(l => `• ${l.replace(/^\d+\.\s*/, '').trim()}`).join('\n') : '_None_';
}

function toSlackText(v) {
  if (!v) return '_None_';
  if (Array.isArray(v)) return v.map(String).filter(l => l.trim() && !/^\d+$/.test(l.trim())).join('\n');
  return String(v);
}

function getViaLabel(via) {
  if (via === 'rules')        return 'rules engine';
  if (via === 'ai-groq')      return 'Groq AI';
  if (via === 'ai-anthropic') return 'Claude AI';
  return 'demo';
}

function buildConfidenceText(confidence) {
  if (confidence == null) return '';
  const conf   = Math.round(confidence);
  const filled = Math.round(conf / 10);
  const bar    = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${conf}%`;
  return `\n:bar_chart: *Confidence:* \`${bar}\``;
}

function buildOptionalBlocks(cmdText, suggestions, isMock) {
  const blocks = [];
  if (cmdText)     blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:terminal: *Commands*\n${cmdText.slice(0, 400)}` } });
  if (suggestions) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:rocket: *Suggestions*\n${suggestions}` } });
  if (isMock)      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '⚠ Demo mode — add GROQ_API_KEY for real AI diagnosis' }] });
  return blocks;
}

async function notifySlack(result, toolModule, webhookUrl) {
  const sev      = result.severity ?? 'unknown';
  const sevEmoji = { critical: '🔴', warning: '🟡', info: '🟢' }[sev] ?? '⚪';
  const sevColor = { critical: '#e74c3c', warning: '#f39c12', info: '#2ecc71' }[sev] ?? '#95a5a6';

  const pipeline  = result.pipeline ? `  |  Pipeline: *${result.pipeline}*` : '';
  const step      = result.step     ? `  |  Step: *${result.step}*`         : '';
  const confText  = buildConfidenceText(result.confidence);
  const via       = getViaLabel(result.via);

  const fixText   = toSlackBullets(result.fixSteps ?? result.commands);
  const cmdText   = result.commands && result.commands !== result.fixSteps
    ? toSlackText(result.commands).split('\n').map(l => `\`${l.trim()}\``).filter(Boolean).join('\n')
    : null;

  const impactText   = result.impact ? `\n\n:zap: *Impact*\n${toSlackText(result.impact).slice(0, 400)}` : '';
  const suggestions  = result.suggestions?.length > 0 ? toSlackBullets(result.suggestions).slice(0, 400) : null;

  const blocks = [
    { type: 'header',  text: { type: 'plain_text', text: `${sevEmoji} ${(result.tool ?? toolModule ?? 'nxs').toUpperCase()} — ${sev.toUpperCase()}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${toSlackText(result.summary).slice(0, 300)}*${pipeline}${step}${confText}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `:mag: *Root cause*\n${toSlackText(result.rootCause).slice(0, 500)}${impactText}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `:wrench: *How to fix*\n${fixText.slice(0, 600)}` } },
    ...buildOptionalBlocks(cmdText, suggestions, result._mock),
    { type: 'context', elements: [{ type: 'mrkdwn', text: `nxs · ${via} · ${new Date().toISOString()}` }] },
  ];

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [{ color: sevColor, blocks }] }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Slack error ${resp.status}: ${text.slice(0, 120)}`);
}

function buildMarkdown(result, logText) {
  const ts = new Date().toISOString();
  const toMd = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.filter((x) => x && typeof x !== 'number').map((x, i) => `${i + 1}. ${x}`).join('\n');
    return String(v ?? '');
  };
  const conf = result.confidence != null ? ` | **Confidence:** ${result.confidence}%` : '';
  const via  = result.via ? ` | **Via:** ${result.via}` : '';

  return `# nxs Analysis — ${(result.tool ?? 'unknown').toUpperCase()}

**Date:** ${ts}
**Severity:** ${result.severity ?? 'unknown'}${conf}${via}
${result.resource ? `**Resource:** ${result.resource}  ` : ''}
${result.namespace && result.namespace !== 'unknown' ? `**Namespace:** ${result.namespace}  ` : ''}

## Summary

${toMd(result.summary)}
${result.impact ? `\n## Impact\n\n${toMd(result.impact)}\n` : ''}
## Root Cause

${toMd(result.rootCause)}

## Fix Steps

${toMd(result.fixSteps)}

## Remediation Commands

\`\`\`bash
${toMd(result.commands)}
\`\`\`
${result.suggestions?.length > 0 ? `\n## Suggestions\n\n${(Array.isArray(result.suggestions) ? result.suggestions : [result.suggestions]).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}
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
