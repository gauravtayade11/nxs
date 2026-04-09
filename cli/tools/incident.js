/**
 * nxs incident — Full incident commander
 * Start, update, close incidents from the CLI.
 * Posts to Slack thread, tracks timeline, generates postmortem.
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
  "prevention": "<action items to prevent recurrence — numbered list>",
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

async function postSlack(webhookUrl, blocks, color = '#e74c3c') {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: [{ color, blocks }] }),
    });
  } catch { /* ignore */ }
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

      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (opts.notify === 'slack' || webhookUrl) {
        await postSlack(webhookUrl, [
          { type: 'header', text: { type: 'plain_text', text: `${sevEmoji(opts.severity)} INCIDENT ${id}: ${opts.title}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Severity:* ${opts.severity.toUpperCase()}${opts.service ? `  |  *Service:* ${opts.service}` : ''}\n*Started:* ${new Date(now).toLocaleString()}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Status:* 🔴 OPEN\n\nUpdate via: \`nxs incident update ${id} --note "..."\`` } },
        ]);
        console.log(chalk.green('  ✓ Slack notified\n'));
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

      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (opts.notify === 'slack' || webhookUrl) {
        const duration = formatDuration(Date.now() - new Date(incident.startedAt).getTime());
        await postSlack(webhookUrl, [
          { type: 'section', text: { type: 'mrkdwn', text: `*${sevEmoji(incident.severity)} ${id}* — ${incident.title}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Update* (${duration} in): ${opts.note}` } },
        ], '#f39c12');
        console.log(chalk.green('  ✓ Slack notified\n'));
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

      const now = new Date().toISOString();
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

      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (opts.notify === 'slack' || webhookUrl) {
        await postSlack(webhookUrl, [
          { type: 'header', text: { type: 'plain_text', text: `✅ RESOLVED ${id}: ${incident.title}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Duration:* ${duration}  |  *Severity:* ${incident.severity.toUpperCase()}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Resolution:* ${opts.resolution}` } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `Postmortem: \`nxs incident postmortem ${id}\`` }] },
        ], '#2ecc71');
        console.log(chalk.green('  ✓ Slack notified\n'));
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
        prevention: '1. Add AI key for automated postmortem generation.\n2. Review incident timeline manually.',
        commands: '',
      }));

      spinner.stop();

      console.log(hr());
      console.log(chalk.bold(`\n  POSTMORTEM — ${incident.id}: ${incident.title}\n`));
      console.log(`  ${chalk.hex('#94a3b8')(result.summary)}\n`);

      if (result.rootCause) {
        console.log(chalk.bold('  Root cause:\n'));
        result.rootCause.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
      }
      if (result.impact) {
        console.log(chalk.bold('\n  Impact:\n'));
        console.log(`  ${chalk.hex('#94a3b8')(result.impact)}`);
      }
      if (result.prevention) {
        console.log(chalk.bold('\n  Prevention action items:\n'));
        result.prevention.split('\n').forEach((l) => console.log(`  ${chalk.hex('#94a3b8')(l)}`));
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
          result.rootCause,
          '',
          `## Timeline`,
          result.timeline ?? incident.updates.map((u) => `- ${u.ts}: ${u.note}`).join('\n'),
          '',
          `## Impact`,
          result.impact,
          '',
          `## Resolution`,
          incident.resolution ?? 'N/A',
          '',
          `## Prevention`,
          result.prevention,
        ].join('\n');
        writeFileSync(opts.output, md, 'utf8');
        console.log(chalk.green(`\n  ✓ Postmortem saved to ${opts.output}\n`));
      }

      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (opts.notify === 'slack' && webhookUrl) {
        await postSlack(webhookUrl, [
          { type: 'header', text: { type: 'plain_text', text: `📋 Postmortem: ${incident.id}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${incident.title}*\n${result.summary}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Root cause:* ${(result.rootCause ?? '').slice(0, 200)}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Prevention:*\n${(result.prevention ?? '').slice(0, 300)}` } },
        ], '#3498db');
        console.log(chalk.green('  ✓ Posted to Slack\n'));
      }
    });
}
