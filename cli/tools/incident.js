/**
 * nxs incident — Full incident commander
 * Start, update, close incidents from the CLI.
 * Posts to Slack thread (bot token) or webhook, tracks timeline, generates postmortem.
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { analyze } from '../core/ai.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const INCIDENTS_FILE = join(homedir(), '.nxs', 'incidents.json');
const NXS_DIR        = join(homedir(), '.nxs');

const POSTMORTEM_PROMPT = `You are an SRE writing a production incident postmortem.
Given an incident timeline with start time, updates, resolution, and severity, generate a thorough postmortem.

Return a JSON object with exactly this structure:
{
  "tool": "incident",
  "severity": "<incident severity>",
  "summary": "<1-2 sentence executive summary>",
  "rootCause": "<detailed root cause analysis>",
  "timeline": "<key events in chronological order>",
  "impact": "<who was affected and for how long>",
  "fixSteps": "<what was done to resolve it>",
  "prevention": "<action items to prevent recurrence — numbered list as array of strings>",
  "commands": "<any key commands used during the incident>"
}

Return ONLY valid JSON. No markdown fences.`;

function loadIncidents() {
  if (!existsSync(INCIDENTS_FILE)) return [];
  try { return JSON.parse(readFileSync(INCIDENTS_FILE, 'utf8')); } catch { return []; }
}

function saveIncidents(incidents) {
  if (!existsSync(NXS_DIR)) mkdirSync(NXS_DIR, { recursive: true });
  writeFileSync(INCIDENTS_FILE, JSON.stringify(incidents, null, 2), 'utf8');
}

function genId() {
  return `INC-${Date.now().toString(36).toUpperCase()}`;
}

// Convert AI output (string or array) to Slack bullet list
function slackBullets(v) {
  if (!v) return '_None_';
  const items = Array.isArray(v)
    ? v.map(String).filter(l => l.trim() && !/^\d+$/.test(l.trim()))
    : String(v).split('\n').filter(l => l.trim());
  if (items.length === 0) return '_None_';
  return items.map(l => `• ${l.replace(/^\d+\.\s*/, '').trim()}`).join('\n');
}

// ── Slack helpers ─────────────────────────────────────────────────────────────
// Mode 1: SLACK_BOT_TOKEN + SLACK_CHANNEL → chat.postMessage (supports threading)
// Mode 2: SLACK_WEBHOOK_URL               → incoming webhook (no threading)

async function postSlackApi(token, channel, blocks, color = '#e74c3c', threadTs = null) {
  const body = { channel, attachments: [{ color, blocks }] };
  if (threadTs) body.thread_ts = threadTs;
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(chalk.red(`  ✗ Slack API error: ${data.error}`));
      if (data.error === 'not_in_channel') console.error(chalk.dim('  → Invite bot: /invite @your-bot-name'));
      if (data.error === 'channel_not_found') console.error(chalk.dim(`  → Channel "${channel}" not found — check SLACK_CHANNEL`));
      if (data.error === 'invalid_auth') console.error(chalk.dim('  → Invalid SLACK_BOT_TOKEN — regenerate at api.slack.com'));
      return null;
    }
    return data.ts;
  } catch (e) {
    console.error(chalk.red(`  ✗ Slack request failed: ${e.message}`));
    return null;
  }
}

async function postSlackWebhook(webhookUrl, blocks) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });
    const text = await res.text();
    if (!res.ok || text !== 'ok') {
      console.error(chalk.red(`  ✗ Slack webhook error: ${text}`));
      return null;
    }
    return 'webhook';
  } catch (e) {
    console.error(chalk.red(`  ✗ Slack webhook failed: ${e.message}`));
    return null;
  }
}

async function postSlack(blocks, color = '#e74c3c', threadTs = null) {
  const token   = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL;
  const webhook = process.env.SLACK_WEBHOOK_URL;

  if (token && channel) return await postSlackApi(token, channel, blocks, color, threadTs);
  if (token && !channel) {
    console.error(chalk.red('  ✗ SLACK_BOT_TOKEN set but SLACK_CHANNEL is missing'));
    console.error(chalk.dim('  → Set it: export SLACK_CHANNEL="#incidents"  or  nxs config --set SLACK_CHANNEL=#incidents'));
    return null;
  }
  if (webhook) return await postSlackWebhook(webhook, blocks);
  return null;
}

function sevColor(sev) {
  return sev === 'critical' ? chalk.red.bold : sev === 'high' ? chalk.red : sev === 'medium' ? chalk.yellow : chalk.green;
}

function sevEmoji(sev) {
  return { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[sev] ?? '⚪';
}

function formatDuration(ms) {
  const mins  = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// Normalize AI output to array of non-empty strings
function toLines(v) {
  if (Array.isArray(v)) return v.map(String).filter(l => l.trim() && !/^\d+$/.test(l.trim()));
  return String(v).split('\n').filter(Boolean);
}

export function registerIncident(program) {
  const inc = program
    .command('incident')
    .description('Full incident commander — start, track, close, and generate postmortems');

  // ── incident start ──
  inc
    .command('start')
    .description('Start a new incident')
    .requiredOption('--title <title>', 'Incident title')
    .option('--severity <sev>', 'Severity: critical|high|medium|low', 'high')
    .option('--service <service>', 'Affected service')
    .option('--notify <target>', 'Post to Slack')
    .addHelpText('after', `
Examples:
  $ nxs incident start --title "API latency spike" --severity critical
  $ nxs incident start --title "DB connection pool exhausted" --severity high --service payments`)
    .action(async (opts) => {
      printBanner('Incident commander');
      const id = genId();
      const now = new Date().toISOString();
      const incident = {
        id, title: opts.title, severity: opts.severity,
        service: opts.service ?? null,
        status: 'open',
        startedAt: now,
        closedAt: null,
        resolvedBy: null,
        updates: [{ ts: now, type: 'open', note: `Incident opened: ${opts.title}` }],
        slackThreadTs: null,
      };

      const incidents = loadIncidents();
      incidents.unshift(incident);
      saveIncidents(incidents);

      console.log(hr());
      console.log(`\n  ${chalk.red.bold('🚨 INCIDENT OPENED')}\n`);
      console.log(`  ID        : ${chalk.white.bold(id)}`);
      console.log(`  Title     : ${chalk.white(opts.title)}`);
      console.log(`  Severity  : ${sevColor(opts.severity)(opts.severity.toUpperCase())}`);
      if (opts.service) console.log(`  Service   : ${chalk.dim(opts.service)}`);
      console.log(`  Started   : ${chalk.dim(now)}\n`);
      console.log(hr());
      console.log(chalk.bold('\n  Next steps:\n'));
      console.log(chalk.dim(`  nxs incident update ${id} --note "Root cause identified: ..."`));
      console.log(chalk.dim(`  nxs incident close  ${id} --resolution "Fixed by ..."\n`));

      const shouldNotify = opts.notify === 'slack' || process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL;
      if (shouldNotify) {
        const fields = [
          `*Severity:*\n${opts.severity.toUpperCase()}`,
          `*Status:*\n🔴 OPEN`,
        ];
        if (opts.service) fields.push(`*Service:*\n${opts.service}`);
        const ts = await postSlack([
          { type: 'header', text: { type: 'plain_text', text: `${sevEmoji(opts.severity)} INCIDENT DECLARED` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${id}* — ${opts.title}` } },
          { type: 'section', fields: fields.map(f => ({ type: 'mrkdwn', text: f })) },
          { type: 'section', text: { type: 'mrkdwn', text: `*Started:* ${new Date(now).toLocaleString()}` } },
          { type: 'divider' },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Update: \`nxs incident update ${id} --note "..."\`  |  Close: \`nxs incident close ${id} --resolution "..."\`` }] },
        ]);
        if (ts) {
          incident.slackThreadTs = ts;
          saveIncidents(incidents);
          console.log(chalk.green('  ✓ Slack notified\n'));
        }
      }
    });

  // ── incident update ──
  inc
    .command('update <id>')
    .description('Add an update to an open incident')
    .requiredOption('--note <note>', 'Update note')
    .option('--notify <target>', 'Post update to Slack')
    .action(async (id, opts) => {
      const incidents = loadIncidents();
      const incident  = incidents.find((i) => i.id === id);
      if (!incident) {
        console.error(chalk.red(`  Incident ${id} not found. Run: nxs incident list`));
        process.exit(1);
      }
      if (incident.status === 'closed') {
        console.log(chalk.yellow(`  Warning: incident ${id} is already closed.\n`));
      }

      const now = new Date().toISOString();
      incident.updates.push({ ts: now, type: 'update', note: opts.note });
      saveIncidents(incidents);

      printBanner('Incident commander');
      console.log(hr());
      console.log(`\n  ${chalk.blue('● UPDATE')} — ${chalk.white.bold(id)}\n`);
      console.log(`  ${chalk.dim(new Date(now).toLocaleString())}  ${chalk.hex('#94a3b8')(opts.note)}\n`);
      console.log(hr() + '\n');

      const shouldNotify = opts.notify === 'slack' || process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL;
      if (shouldNotify) {
        const duration     = formatDuration(Date.now() - new Date(incident.startedAt).getTime());
        const updateCount  = incident.updates.filter(u => u.type === 'update').length;
        const ts = await postSlack([
          { type: 'section', text: { type: 'mrkdwn', text: `*:pencil: Update #${updateCount} — ${id}*\n${incident.title}` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: opts.note } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Time into incident: *${duration}*  |  Severity: *${incident.severity.toUpperCase()}*` }] },
        ], '#f39c12', incident.slackThreadTs);
        if (ts) console.log(chalk.green('  ✓ Slack notified\n'));
      }
    });

  // ── incident close ──
  inc
    .command('close <id>')
    .description('Close and resolve an incident')
    .requiredOption('--resolution <text>', 'How was it resolved?')
    .option('--notify <target>', 'Post resolution to Slack')
    .action(async (id, opts) => {
      const incidents = loadIncidents();
      const incident  = incidents.find((i) => i.id === id);
      if (!incident) {
        console.error(chalk.red(`  Incident ${id} not found.`));
        process.exit(1);
      }

      const now      = new Date().toISOString();
      const duration = formatDuration(Date.now() - new Date(incident.startedAt).getTime());
      incident.status     = 'closed';
      incident.closedAt   = now;
      incident.resolution = opts.resolution;
      incident.updates.push({ ts: now, type: 'close', note: `Resolved: ${opts.resolution}` });
      saveIncidents(incidents);

      printBanner('Incident commander');
      console.log(hr());
      console.log(`\n  ${chalk.green.bold('✓ INCIDENT RESOLVED')} — ${chalk.white.bold(id)}\n`);
      console.log(`  Title      : ${chalk.white(incident.title)}`);
      console.log(`  Duration   : ${chalk.yellow(duration)}`);
      console.log(`  Resolution : ${chalk.hex('#94a3b8')(opts.resolution)}\n`);
      console.log(hr());
      console.log(chalk.dim(`\n  Generate postmortem: nxs incident postmortem ${id}\n`));

      const shouldNotify = opts.notify === 'slack' || process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL;
      if (shouldNotify) {
        const ts = await postSlack([
          { type: 'header', text: { type: 'plain_text', text: `✅ INCIDENT RESOLVED` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${id}* — ${incident.title}` } },
          { type: 'section', fields: [
            { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
            { type: 'mrkdwn', text: `*Severity:*\n${incident.severity.toUpperCase()}` },
          ]},
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `*:white_check_mark: Resolution*\n${opts.resolution}` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Run postmortem: \`nxs incident postmortem ${id}\`` }] },
        ], '#2ecc71', incident.slackThreadTs);
        if (ts) console.log(chalk.green('  ✓ Slack notified\n'));
      }
    });

  // ── incident list ──
  inc
    .command('list')
    .description('List all incidents')
    .option('--open', 'Show only open incidents')
    .option('-j, --json', 'Output as JSON')
    .action((opts) => {
      const incidents = loadIncidents();
      const filtered  = opts.open ? incidents.filter((i) => i.status === 'open') : incidents;

      if (opts.json) { console.log(JSON.stringify(filtered, null, 2)); return; }

      printBanner('Incident commander');
      if (filtered.length === 0) {
        console.log(chalk.dim(opts.open ? '  No open incidents.\n' : '  No incidents yet.\n'));
        console.log(chalk.dim('  Start one: nxs incident start --title "..." --severity critical\n'));
        return;
      }

      console.log(hr());
      console.log(chalk.bold(`\n  Incidents (${filtered.length})\n`));
      filtered.forEach((inc, i) => {
        const status = inc.status === 'open'
          ? chalk.red.bold('● OPEN  ')
          : chalk.green('✓ CLOSED');
        const dur = inc.closedAt
          ? formatDuration(new Date(inc.closedAt).getTime() - new Date(inc.startedAt).getTime())
          : formatDuration(Date.now() - new Date(inc.startedAt).getTime()) + ' (ongoing)';
        console.log(`\n  ${chalk.dim(`${i + 1}.`)} ${status}  ${chalk.white.bold(inc.id)}  ${sevColor(inc.severity)(inc.severity.toUpperCase())}`);
        console.log(`     ${chalk.white(inc.title)}`);
        console.log(`     ${chalk.dim(`Started: ${new Date(inc.startedAt).toLocaleString()}  |  Duration: ${dur}`)}`);
        if (inc.resolution) console.log(`     ${chalk.hex('#94a3b8')('Resolution: ' + inc.resolution.slice(0, 80))}`);
      });
      console.log('\n' + hr() + '\n');
    });

  // ── incident view ──
  inc
    .command('view <id>')
    .description('View full timeline of an incident')
    .action((id) => {
      const incident = loadIncidents().find((i) => i.id === id);
      if (!incident) { console.error(chalk.red(`  Incident ${id} not found.`)); process.exit(1); }

      printBanner('Incident commander');
      console.log(hr());
      console.log(`\n  ${chalk.white.bold(incident.id)} — ${chalk.white(incident.title)}\n`);
      console.log(`  Severity : ${sevColor(incident.severity)(incident.severity.toUpperCase())}`);
      console.log(`  Status   : ${incident.status === 'open' ? chalk.red('OPEN') : chalk.green('CLOSED')}`);
      if (incident.service) console.log(`  Service  : ${chalk.dim(incident.service)}`);
      console.log('');
      console.log(hr());
      console.log(chalk.bold('\n  Timeline:\n'));
      incident.updates.forEach((u) => {
        const icon = u.type === 'open' ? chalk.red('◆') : u.type === 'close' ? chalk.green('✓') : chalk.blue('●');
        console.log(`  ${chalk.dim(new Date(u.ts).toLocaleTimeString())}  ${icon}  ${chalk.hex('#94a3b8')(u.note)}`);
      });
      if (incident.resolution) {
        console.log(`\n  ${chalk.green.bold('Resolution:')} ${chalk.hex('#94a3b8')(incident.resolution)}`);
      }
      console.log('\n' + hr() + '\n');
    });

  // ── incident postmortem ──
  inc
    .command('postmortem <id>')
    .description('AI-generated postmortem for a closed incident')
    .option('-o, --output <file>', 'Save postmortem as markdown file')
    .option('--notify <target>', 'Post postmortem summary to Slack')
    .action(async (id, opts) => {
      const incident = loadIncidents().find((i) => i.id === id);
      if (!incident) { console.error(chalk.red(`  Incident ${id} not found.`)); process.exit(1); }

      printBanner('Incident commander');
      const ora     = (await import('ora')).default;
      const spinner = ora('Generating postmortem…').start();

      const context = JSON.stringify({
        id: incident.id,
        title: incident.title,
        severity: incident.severity,
        service: incident.service,
        duration: incident.closedAt
          ? formatDuration(new Date(incident.closedAt).getTime() - new Date(incident.startedAt).getTime())
          : 'ongoing',
        timeline: incident.updates,
        resolution: incident.resolution,
      }, null, 2);

      const result = await analyze(context, POSTMORTEM_PROMPT, () => ({
        tool: 'incident', severity: incident.severity,
        summary: `Incident ${id}: ${incident.title}`,
        rootCause: 'Postmortem requires AI key — run: nxs config --setup',
        timeline: incident.updates.map((u) => `${u.ts}: ${u.note}`).join('\n'),
        impact: 'Unknown — add AI key for full analysis',
        fixSteps: incident.resolution ?? 'Not resolved yet',
        prevention: ['Add AI key for automated postmortem generation.', 'Review incident timeline manually.'],
        commands: '',
      }));

      spinner.stop();

      console.log(hr());
      console.log(chalk.bold(`\n  POSTMORTEM — ${incident.id}: ${incident.title}\n`));
      console.log(`  ${chalk.hex('#94a3b8')(result.summary)}\n`);

      if (result.rootCause) {
        console.log(chalk.bold('  Root cause:\n'));
        toLines(result.rootCause).forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
      }
      if (result.impact) {
        console.log(chalk.bold('\n  Impact:\n'));
        toLines(result.impact).forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
      }
      if (result.prevention) {
        console.log(chalk.bold('\n  Prevention action items:\n'));
        toLines(result.prevention).forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
      }
      console.log('\n' + hr());

      if (opts.output) {
        const md = [
          `# Postmortem — ${incident.id}: ${incident.title}`,
          `**Severity:** ${incident.severity}  |  **Service:** ${incident.service ?? 'unknown'}`,
          '',
          `## Summary`,
          result.summary,
          '',
          `## Root Cause`,
          toLines(result.rootCause).join('\n'),
          '',
          `## Timeline`,
          result.timeline ?? incident.updates.map((u) => `- ${u.ts}: ${u.note}`).join('\n'),
          '',
          `## Impact`,
          toLines(result.impact).join('\n'),
          '',
          `## Resolution`,
          incident.resolution ?? 'N/A',
          '',
          `## Prevention`,
          toLines(result.prevention).map((l, i) => `${i + 1}. ${l}`).join('\n'),
        ].join('\n');
        writeFileSync(opts.output, md, 'utf8');
        console.log(chalk.green(`\n  ✓ Postmortem saved to ${opts.output}\n`));
      }

      const shouldNotify = opts.notify === 'slack' || process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL;
      if (shouldNotify) {
        const rootCauseText = toLines(result.rootCause).join('\n');
        const ts = await postSlack([
          { type: 'header', text: { type: 'plain_text', text: `📋 Postmortem: ${incident.id}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${incident.title}*\n\n${result.summary}` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `:mag: *Root cause*\n${rootCauseText.slice(0, 300)}` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `:shield: *Prevention action items*\n${slackBullets(result.prevention).slice(0, 600)}` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Severity: *${incident.severity.toUpperCase()}*  |  Duration: *${formatDuration(new Date(incident.closedAt ?? Date.now()).getTime() - new Date(incident.startedAt).getTime())}*` }] },
        ], '#3498db', incident.slackThreadTs);
        if (ts) console.log(chalk.green('  ✓ Posted to Slack\n'));
      }
    });
}
