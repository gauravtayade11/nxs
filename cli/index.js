#!/usr/bin/env node
import { resolve } from 'node:path';
import { config }  from 'dotenv';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

import { applyConfig, loadConfig, saveConfig, loadHistory, CONFIG_FILE, HISTORY_FILE } from './core/config.js';
import { printBanner, providerInfo, hr, prompt, VERSION } from './core/ui.js';
import { registerDevops }  from './tools/devops.js';
import { registerCloud }   from './tools/cloud.js';
import { registerK8s }     from './tools/k8s.js';
import { registerSec }     from './tools/sec.js';
import { registerNet }     from './tools/net.js';
import { registerDb }      from './tools/db.js';
import { registerCi }      from './tools/ci.js';
import { registerExplain } from './tools/explain.js';
import { registerWatch }   from './tools/watch.js';
import { registerServe }   from './tools/serve.js';
import { registerRbac }    from './tools/rbac.js';
import { registerStatus, registerK8sStatus, registerDevopsPipelines } from './tools/status.js';
import { registerNoise }     from './tools/noise.js';
import { registerBlame }     from './tools/blame.js';
import { registerPredict }   from './tools/predict.js';
import { registerIncident }  from './tools/incident.js';
import { registerAutopilot } from './tools/autopilot.js';

// Load .env then persisted config (quiet: true suppresses dotenv v17 promo output)
config({ path: resolve(process.cwd(), '.env'), quiet: true });
applyConfig();

// ── Root program ───────────────────────────────────────────────────────────

const program = new Command();

program
  .name('nxs')
  .description('NextSight — multi-tool DevOps & Cloud debugger')
  .version(VERSION, '-v, --version');

// ── Register tool modules ──────────────────────────────────────────────────

registerDevops(program);
registerCloud(program);
registerK8s(program);
registerSec(program);
registerNet(program);
registerDb(program);
registerCi(program);
registerExplain(program);
registerWatch(program);
registerServe(program);
registerRbac(program);
registerStatus(program);
registerNoise(program);
registerBlame(program);
registerPredict(program);
registerIncident(program);
registerAutopilot(program);

// Wire status sub-commands into existing tools
const k8sCmd     = program.commands.find((c) => c.name() === 'k8s');
const devopsCmd  = program.commands.find((c) => c.name() === 'devops');
if (k8sCmd)    registerK8sStatus(k8sCmd);
if (devopsCmd) registerDevopsPipelines(devopsCmd);

// ── nxs info ──────────────────────────────────────────────────────────────

program
  .command('info')
  .description('What is nxs? Features and use cases')
  .action(() => {
    printBanner();

    // ── What is it ──
    console.log(hr());
    console.log(chalk.bold('\n  What is nxs?\n'));
    console.log(chalk.hex('#94a3b8')('  AI-powered DevOps & Cloud debugger.\n'));
    console.log(chalk.hex('#94a3b8')('  Paste any error log — Kubernetes, Docker, CI/CD, AWS, GCP, Azure,'));
    console.log(chalk.hex('#94a3b8')('  Terraform — and instantly get root cause + fix commands.\n'));
    console.log(chalk.hex('#94a3b8')('  Pipe any log, get AI root cause + fix. Notify Slack. Integrate with\n  Prometheus Alertmanager. Run as a REST API for your team.\n'));

    // ── Tools ──
    console.log(hr());
    console.log(chalk.bold('\n  Tools:\n'));

    const tools = [
      {
        name: 'nxs devops', color: chalk.yellow,
        tagline: 'CI/CD · Docker · Terraform',
        features: [
          ['analyze <file/--stdin>',  'Root cause + fix for pipeline, Docker, Terraform errors'],
          ['pipelines',               'GitHub Actions run status (active, recent, failed)'],
          ['examples',                'Sample error logs to test with'],
        ],
      },
      {
        name: 'nxs cloud', color: chalk.hex('#FF9900'),
        tagline: 'AWS · GCP · Azure',
        features: [
          ['diagnose <file/--stdin>', 'Diagnose IAM, RBAC, permission, and config errors'],
          ['providers',               'List supported services per cloud provider'],
        ],
      },
      {
        name: 'nxs k8s', color: chalk.blue,
        tagline: 'Kubernetes',
        features: [
          ['debug <file/--stdin>',    'Debug pod logs, events, describe output'],
          ['status [-n namespace]',   'Nodes · pods · deployments at a glance'],
          ['pods [--watch]',          'Pod counts by status, unhealthy highlighted, live refresh'],
          ['errors',                  'Quick reference card for all K8s error types'],
        ],
      },
      {
        name: 'nxs sec', color: chalk.hex('#ff4757'),
        tagline: 'Security scans — Trivy · Grype · Snyk · OWASP',
        features: [
          ['scan <file/--stdin>',      'Analyze Trivy, Grype, Snyk, OWASP scan output'],
          ['scan --image <name>',      'Scan a Docker image directly (requires trivy)'],
          ['scan --pod <name>',        'Auto-detect pod image and scan it'],
          ['cluster [-n <namespace>]', 'Scan ALL images running in the cluster'],
          ['severities',              'CVE severity reference card'],
        ],
      },
      {
        name: 'nxs net', color: chalk.hex('#00b4d8'),
        tagline: 'DNS · TLS · timeouts · HTTP failures',
        features: [
          ['diagnose <file/--stdin>', 'Analyze any network error or connectivity failure'],
          ['diagnose --check <host>', 'Live check: ping + DNS + TCP in one command'],
          ['diagnose --cert <host>',  'Check TLS certificate expiry'],
          ['errors',                  'Common network error reference card'],
        ],
      },
      {
        name: 'nxs db', color: chalk.hex('#f4a261'),
        tagline: 'PostgreSQL · MySQL · MongoDB · Redis',
        features: [
          ['diagnose <file/--stdin>',              'Analyze database errors and connection failures'],
          ['connections --pod <name> [-n <ns>]',   'Live connection monitor — auto-kill idle on threshold'],
          ['connections --pod <name> --watch',     'Keep watching, auto-kill every N seconds'],
          ['errors',                               'Common DB error reference card'],
        ],
      },
      {
        name: 'nxs ci', color: chalk.hex('#f9ca24'),
        tagline: 'GitHub Actions · GitLab CI · Jenkins · CircleCI',
        features: [
          ['analyze <file/--stdin>',   'Root cause + fix for any CI/CD pipeline failure'],
          ['analyze --run <id>',       'Auto-fetch a GitHub Actions run log via gh CLI'],
          ['analyze --notify slack',   'Post result to Slack after analysis'],
        ],
      },
      {
        name: 'nxs explain', color: chalk.hex('#a29bfe'),
        tagline: 'Plain-English explainer for any DevOps term',
        features: [
          ['CrashLoopBackOff',         'Explain any Kubernetes error state'],
          ['"CVE-2024-1234"',          'Explain a CVE — CVSS, affected pkg, fix version'],
          ['ETIMEDOUT / ECONNREFUSED', 'Explain any network error code'],
          ['"connection pool exhausted"', 'Explain any phrase or concept'],
        ],
      },
      {
        name: 'nxs watch', color: chalk.hex('#fd79a8'),
        tagline: 'Live log watcher — auto-analyze errors as they appear',
        features: [
          ['<logfile>',                'Tail a file and analyze errors automatically'],
          ['"kubectl logs -f <pod>"',  'Stream any command output and watch for errors'],
          ['<source> --notify slack',  'Alert Slack on every detected error'],
          ['<source> --cooldown 60',   'Control how often analyses fire (default 30s)'],
        ],
      },
      {
        name: 'nxs rbac', color: chalk.hex('#e17055'),
        tagline: 'Kubernetes RBAC scanner',
        features: [
          ['scan',                     'Scan cluster for RBAC misconfigs — cluster-admin, wildcards, anonymous'],
          ['scan -n <namespace>',      'Scan specific namespace'],
          ['scan --fail-on critical',  'Exit 1 if critical findings (use in CI)'],
        ],
      },
      {
        name: 'nxs serve', color: chalk.hex('#00cec9'),
        tagline: 'REST API server — team & Alertmanager integration',
        features: [
          ['--port 4000',              'Start API server  POST /analyze  GET /history  GET /report'],
          ['',                         'POST /webhook/alertmanager — Prometheus → AI → Slack'],
          ['',                         'POST /webhook/github       — CI failure → AI → Slack'],
        ],
      },
      {
        name: 'nxs status', color: chalk.cyan,
        tagline: 'Live dashboard',
        features: [
          ['',                        'Full view: cluster + pipelines + helm releases'],
          ['--only k8s',              'Cluster only'],
          ['--only pipelines',        'GitHub Actions only'],
          ['--only helm',             'Helm releases only'],
        ],
      },
    ];

    tools.forEach(({ name, color, tagline, features }) => {
      console.log(`  ${color.bold(name)}  ${chalk.dim(tagline)}\n`);
      features.forEach(([cmd, desc]) => {
        console.log(
          `    ${chalk.dim('›')} ${chalk.cyan((name + (cmd ? ' ' + cmd : '')).padEnd(38))} ${chalk.hex('#64748b')(desc)}`
        );
      });
      console.log('');
    });

    // ── Real-world one-liners ──
    console.log(hr());
    console.log(chalk.bold('\n  Real-world one-liners:\n'));

    const examples = [
      ['Debug a crashing pod',          'kubectl logs my-pod --previous | nxs k8s debug --stdin'],
      ['Debug + notify Slack',          'kubectl logs my-pod --previous | nxs k8s debug --stdin --notify slack'],
      ['Docker build failure',          'docker build . 2>&1 | nxs devops analyze --stdin'],
      ['Terraform apply error',         'terraform apply 2>&1 | nxs devops analyze --stdin'],
      ['GitHub Actions failure',        'nxs ci analyze --run 12345'],
      ['Scan cluster images for CVEs',  'nxs sec cluster -n production --detailed'],
      ['RBAC audit',                    'nxs rbac scan --fail-on critical'],
      ['Watch pod logs live',           'nxs watch "kubectl logs -f my-pod" --notify slack'],
      ['Explain any error',             'nxs explain OOMKilled'],
      ['Full infra snapshot',           'nxs status'],
      ['Start team API server',         'NXS_API_KEY=secret nxs serve --port 4000'],
      ['Weekly digest',                 'nxs report --days 7'],
    ];

    examples.forEach(([label, cmd]) => {
      console.log(`  ${chalk.dim('›')} ${chalk.hex('#64748b')(label.padEnd(30))} ${chalk.cyan(cmd)}`);
    });

    // ── Global commands ──
    console.log('\n' + hr());
    console.log(chalk.bold('\n  Global commands:\n'));

    const global_cmds = [
      ['nxs history',              'All past analyses across all tools'],
      ['nxs history --search oom', 'Search history by keyword'],
      ['nxs report --days 7',      'Weekly digest of all analyses'],
      ['nxs config --setup',       'Interactive API key wizard'],
      ['nxs config --set KEY=val', 'Set a key directly'],
      ['nxs update',               'Check for latest version'],
      ['nxs info',                 'This screen'],
    ];

    global_cmds.forEach(([cmd, desc]) => {
      console.log(`  ${chalk.cyan(cmd.padEnd(32))} ${chalk.dim(desc)}`);
    });

    // ── AI providers ──
    console.log('\n' + hr());
    console.log(chalk.bold('\n  AI providers:\n'));

    const p = providerInfo();
    console.log(`  Active now:  ${p.badge(p.label)}  ${p.name}\n`);

    console.log(chalk.dim('  GROQ_API_KEY        Free — console.groq.com'));
    console.log(chalk.dim('  ANTHROPIC_API_KEY   $5 free credits — console.anthropic.com'));
    console.log(chalk.dim('  (no key = demo mode, keyword-based mock responses)\n'));

    console.log(chalk.dim(`  Run:  nxs config --setup   to add a key\n`));

    console.log(hr() + '\n');
  });

// ── nxs update ────────────────────────────────────────────────────────────

program
  .command('update')
  .description('Check for the latest version and print upgrade command')
  .action(async () => {
    const { execSync } = await import('node:child_process');
    const ora = (await import('ora')).default;
    printBanner();
    const spinner = ora('Checking for updates…').start();
    try {
      const latest = execSync('npm view @nextsight/nxs-cli version 2>/dev/null', { encoding: 'utf8' }).trim();
      spinner.stop();
      if (!latest) throw new Error('empty');
      if (latest === VERSION) {
        console.log(chalk.green(`  ✓ Already on latest version ${chalk.bold(VERSION)}\n`));
      } else {
        console.log(chalk.yellow(`  Update available: ${chalk.bold(latest)}  ${chalk.dim(`(current: ${VERSION})`)}\n`));
        console.log(`  Run:  ${chalk.cyan('npm install -g @nextsight/nxs-cli')}\n`);
      }
    } catch {
      spinner.stop();
      console.log(chalk.dim('  Could not reach npm. Check your connection.\n'));
      console.log(chalk.dim('  Or check manually: npm view @nextsight/nxs-cli version\n'));
    }
  });

// ── nxs config ────────────────────────────────────────────────────────────

program
  .command('config')
  .description('Manage API keys and settings')
  .option('--setup',           'Interactive setup wizard')
  .option('--set <key=value>', 'Set a config value')
  .option('--get',             'Show current config')
  .option('--reset',           'Clear all saved config')
  .addHelpText('after', `
Keys:
  GROQ_API_KEY        Free AI  — console.groq.com
  ANTHROPIC_API_KEY   Claude   — console.anthropic.com

Examples:
  $ nxs config --setup
  $ nxs config --set GROQ_API_KEY=gsk_xxx
  $ nxs config --get`)
  .action(async (opts) => {
    printBanner();

    if (opts.reset) {
      saveConfig({});
      console.log(chalk.green('  ✓ Config cleared.\n'));
      return;
    }

    if (opts.set) {
      const idx = opts.set.indexOf('=');
      if (idx === -1) { console.error(chalk.red('  Format: --set KEY=VALUE')); process.exit(1); }
      const key = opts.set.slice(0, idx).trim();
      const val = opts.set.slice(idx + 1).trim();
      const cfg = loadConfig();
      cfg[key] = val;
      saveConfig(cfg);
      console.log(chalk.green(`  ✓ Saved ${key}\n`));
      console.log(chalk.dim(`  Config: ${CONFIG_FILE}\n`));
      return;
    }

    if (opts.get) {
      const cfg = loadConfig();
      const keys = Object.keys(cfg);
      if (keys.length === 0) {
        console.log(chalk.dim('  No config saved. Run: nxs config --setup\n'));
      } else {
        console.log(chalk.bold('  Saved config:\n'));
        keys.forEach((k) => {
          const v = cfg[k];
          console.log(`  ${chalk.yellow(k.padEnd(22))} ${chalk.dim(v.slice(0, 6) + '••••' + v.slice(-4))}`);
        });
        console.log(chalk.dim(`\n  File: ${CONFIG_FILE}\n`));
      }
      return;
    }

    if (opts.setup) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const cfg = loadConfig();

      console.log(chalk.bold('  Setup wizard — press Enter to skip\n'));
      console.log(chalk.dim('  Groq (free):      https://console.groq.com'));
      console.log(chalk.dim('  Anthropic Claude: https://console.anthropic.com\n'));

      const groq = await prompt(rl, `  ${chalk.yellow('GROQ_API_KEY')}       › `);
      if (groq.trim()) cfg.GROQ_API_KEY = groq.trim();

      const ant = await prompt(rl, `  ${chalk.yellow('ANTHROPIC_API_KEY')} › `);
      if (ant.trim()) cfg.ANTHROPIC_API_KEY = ant.trim();

      rl.close();
      saveConfig(cfg);
      console.log(chalk.green('\n  ✓ Config saved!\n'));
      console.log(chalk.dim(`  File: ${CONFIG_FILE}\n`));
      return;
    }

    // Default: show provider status
    const p = providerInfo();
    console.log(chalk.bold('  Current provider:\n'));
    console.log(`  ${p.badge(p.label)}  ${p.name}\n`);
    console.log(chalk.dim('  nxs config --setup         interactive wizard'));
    console.log(chalk.dim('  nxs config --set KEY=VAL   set a single key'));
    console.log(chalk.dim('  nxs config --get           show saved keys\n'));
  });

// ── nxs history (all tools) ────────────────────────────────────────────────

program
  .command('history')
  .description('Show all past analyses across all tools')
  .option('-n, --limit <n>', 'Number of entries', '20')
  .option('--clear', 'Clear ALL history')
  .option('--search <term>', 'Search history by keyword')
  .option('-j, --json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ nxs history
  $ nxs history -n 5
  $ nxs history --search CrashLoopBackOff
  $ nxs history --search "connection pool"
  $ nxs history --clear`)
  .action(async (opts) => {
    if (opts.clear) {
      const { saveHistory } = await import('./core/config.js');
      saveHistory([]);
      console.log(chalk.green('  ✓ All history cleared.\n'));
      return;
    }

    let entries = loadHistory();

    // --search: filter by keyword across summary, rootCause, logPreview
    if (opts.search) {
      const term = opts.search.toLowerCase();
      entries = entries.filter((e) =>
        (e.summary ?? '').toLowerCase().includes(term) ||
        (e.rootCause ?? '').toLowerCase().includes(term) ||
        (e.tool ?? '').toLowerCase().includes(term) ||
        (e.toolModule ?? '').toLowerCase().includes(term) ||
        (e.logPreview ?? '').toLowerCase().includes(term)
      );
    }

    entries = entries.slice(0, Number.parseInt(opts.limit, 10));
    if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }

    printBanner();

    if (opts.search && entries.length === 0) {
      console.log(chalk.dim(`  No results for "${opts.search}".\n`));
      return;
    }

    if (entries.length === 0) {
      console.log(chalk.dim('  No history yet. Try: nxs devops analyze error.log\n'));
      return;
    }

    if (opts.search) {
      console.log(chalk.bold(`  Search: "${opts.search}"  —  ${entries.length} result(s)\n`));
      console.log(hr());
    }

    // Group by tool module
    const groups = {};
    entries.forEach((e) => {
      const m = e.toolModule ?? 'unknown';
      if (!groups[m]) groups[m] = [];
      groups[m].push(e);
    });

    const moduleColors = { devops: chalk.yellow, cloud: chalk.hex('#FF9900'), k8s: chalk.blue };

    Object.entries(groups).forEach(([mod, items]) => {
      const col = moduleColors[mod] ?? chalk.white;
      console.log(col.bold(`\n  ● ${mod.toUpperCase()}\n`));
      console.log(hr());
      items.forEach((e, i) => {
        const date = new Date(e.timestamp).toLocaleString();
        const sev = e.severity;
        const sevBadge = sev === 'critical' ? chalk.red(' CRITICAL') : sev === 'warning' ? chalk.yellow(' WARNING') : '';
        const idx = chalk.dim(`${i + 1}.`);
        const tool = chalk.bold.white(e.tool ?? 'unknown');
        const ts = chalk.dim(date);
        console.log(`\n  ${idx} ${tool}${sevBadge}  ${ts}`);
        console.log(`     ${chalk.hex('#94a3b8')(e.summary)}`);
        if (e.logPreview) console.log(`     ${chalk.dim(e.logPreview.replace(/\n/g, ' ').slice(0, 80) + '…')}`);
      });
      console.log('\n' + hr());
    });

    console.log(chalk.dim(`\n  History file: ${HISTORY_FILE}\n`));
  });

// ── nxs report ────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Generate a digest of past analyses (last 7 days by default)')
  .option('--days <n>', 'Number of days to include', '7')
  .option('-o, --output <file>', 'Save report as markdown file')
  .option('--notify <target>', 'Post report to: slack')
  .option('-j, --json', 'Output raw stats as JSON')
  .addHelpText('after', `
Examples:
  $ nxs report
  $ nxs report --days 30
  $ nxs report --output weekly.md
  $ nxs report --notify slack
  $ nxs report --days 1 --notify slack   # daily digest`)
  .action(async (opts) => {
    const days = Math.min(Number.parseInt(opts.days, 10) || 7, 365);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = loadHistory().filter((e) => new Date(e.timestamp).getTime() > since);

    // Stats
    const counts  = { critical: 0, warning: 0, info: 0 };
    const byTool  = {};
    for (const e of entries) {
      const sev = e.severity ?? 'info';
      counts[sev] = (counts[sev] ?? 0) + 1;
      const mod = e.toolModule ?? 'unknown';
      if (!byTool[mod]) byTool[mod] = { total: 0, critical: 0, warning: 0, info: 0 };
      byTool[mod].total++;
      byTool[mod][sev] = (byTool[mod][sev] ?? 0) + 1;
    }

    if (opts.json) {
      console.log(JSON.stringify({ days, total: entries.length, counts, byTool }, null, 2));
      return;
    }

    printBanner('Weekly digest');

    const dateRange = `${new Date(since).toLocaleDateString()} – ${new Date().toLocaleDateString()}`;
    console.log(hr());
    console.log(chalk.bold(`\n  REPORT — last ${days} day${days !== 1 ? 's' : ''}  ${chalk.dim(`(${dateRange})`)}\n`));

    console.log(`  Total analyses  : ${chalk.white(entries.length)}`);
    console.log(`  Critical        : ${counts.critical > 0 ? chalk.red.bold(counts.critical) : chalk.dim(counts.critical)}`);
    console.log(`  Warning         : ${counts.warning  > 0 ? chalk.yellow(counts.warning)    : chalk.dim(counts.warning)}`);
    console.log(`  Info            : ${chalk.dim(counts.info)}`);

    if (Object.keys(byTool).length > 0) {
      console.log(chalk.bold('\n  By tool:\n'));
      console.log(hr());
      Object.entries(byTool)
        .sort((a, b) => b[1].critical - a[1].critical || b[1].total - a[1].total)
        .forEach(([tool, s]) => {
          const bar = '█'.repeat(Math.min(s.total, 20));
          const sevStr = s.critical > 0 ? chalk.red(`C:${s.critical} `) : '';
          const warnStr = s.warning > 0 ? chalk.yellow(`W:${s.warning} `) : '';
          console.log(`  ${chalk.white(tool.padEnd(12))}  ${chalk.dim(bar.padEnd(20))}  ${sevStr}${warnStr}${chalk.dim(`${s.total} total`)}`);
        });
    }

    const topCritical = entries.filter((e) => e.severity === 'critical').slice(0, 5);
    if (topCritical.length > 0) {
      console.log(chalk.bold('\n  Top critical issues:\n'));
      console.log(hr());
      topCritical.forEach((e, i) => {
        console.log(`\n  ${chalk.dim(`${i + 1}.`)} ${chalk.red.bold(e.tool ?? e.toolModule ?? 'unknown')}  ${chalk.dim(new Date(e.timestamp).toLocaleString())}`);
        console.log(`     ${chalk.hex('#94a3b8')(e.summary?.slice(0, 120) ?? '')}`);
      });
    }

    console.log('\n' + hr() + '\n');

    // --output: save markdown
    if (opts.output) {
      const lines = [
        `# nxs Report — Last ${days} Days`,
        `**Period:** ${dateRange}  |  **Total:** ${entries.length}  |  **Critical:** ${counts.critical}  |  **Warning:** ${counts.warning}`,
        '',
        '## By Tool',
        '',
        '| Tool | Total | Critical | Warning | Info |',
        '|------|-------|----------|---------|------|',
        ...Object.entries(byTool)
          .sort((a, b) => b[1].critical - a[1].critical)
          .map(([tool, s]) => `| ${tool} | ${s.total} | ${s.critical} | ${s.warning} | ${s.info} |`),
        '',
        '## Critical Issues',
        '',
        ...topCritical.flatMap((e) => [
          `### ${e.tool ?? e.toolModule} — ${new Date(e.timestamp).toLocaleString()}`,
          `${e.summary ?? ''}`,
          '',
        ]),
        entries.length === 0 ? '_No analyses in this period._' : '',
      ];
      const { writeFileSync } = await import('node:fs');
      writeFileSync(opts.output, lines.join('\n'), 'utf8');
      console.log(chalk.green(`  ✓ Report saved to ${opts.output}\n`));
    }

    // --notify slack
    if (opts.notify === 'slack') {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) {
        console.log(chalk.yellow('  ⚠ SLACK_WEBHOOK_URL not set\n'));
      } else {
        try {
          const sevEmoji = counts.critical > 0 ? '🔴' : counts.warning > 0 ? '🟡' : '🟢';
          const toolLines = Object.entries(byTool)
            .sort((a, b) => b[1].critical - a[1].critical)
            .slice(0, 6)
            .map(([tool, s]) => `• *${tool}*: ${s.total} analyses${s.critical > 0 ? ` (🔴 ${s.critical} critical)` : ''}`)
            .join('\n');

          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attachments: [{
                color: counts.critical > 0 ? '#e74c3c' : counts.warning > 0 ? '#f39c12' : '#2ecc71',
                blocks: [
                  { type: 'header', text: { type: 'plain_text', text: `${sevEmoji} nxs Report — Last ${days} days` } },
                  { type: 'section', text: { type: 'mrkdwn', text: `*Total:* ${entries.length}  |  🔴 Critical: ${counts.critical}  |  🟡 Warning: ${counts.warning}  |  🟢 Info: ${counts.info}` } },
                  ...(toolLines ? [{ type: 'section', text: { type: 'mrkdwn', text: `*By tool:*\n${toolLines}` } }] : []),
                  ...(topCritical.length > 0 ? [{
                    type: 'section',
                    text: { type: 'mrkdwn', text: `*Top critical:*\n${topCritical.slice(0, 3).map((e) => `• ${e.tool ?? 'unknown'}: ${(e.summary ?? '').slice(0, 100)}`).join('\n')}` },
                  }] : []),
                  { type: 'context', elements: [{ type: 'mrkdwn', text: `nxs report · ${new Date().toISOString()}` }] },
                ],
              }],
            }),
          });
          console.log(chalk.green('  ✓ Report posted to Slack\n'));
        } catch (e) {
          console.log(chalk.yellow(`  ⚠ Slack failed: ${e.message}\n`));
        }
      }
    }
  });

// ── Welcome screen (no args) ───────────────────────────────────────────────

if (process.argv.slice(2).length === 0) {
  printBanner();

  // First-run: no AI key configured
  const _cfg = loadConfig();
  const _hasKey = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY ||
                  _cfg.GROQ_API_KEY || _cfg.ANTHROPIC_API_KEY;
  if (!_hasKey) {
    console.log(chalk.bgYellow.black.bold('  ⚡ No AI key configured  '));
    console.log(chalk.dim('  Run: ') + chalk.cyan('nxs config --setup') + chalk.dim('  to add a free Groq key (console.groq.com)'));
    console.log(chalk.dim('  Or skip — demo mode works without any key.\n'));
  }

  console.log(hr());
  console.log(chalk.bold('\n  Available tools:\n'));

  const tools = [
    {
      name: 'devops',
      color: chalk.yellow,
      desc: 'CI/CD pipelines, Docker builds, Terraform errors',
      cmds: ['analyze <file>', 'analyze --stdin', 'pipelines', 'examples'],
    },
    {
      name: 'cloud',
      color: chalk.hex('#FF9900'),
      desc: 'AWS, GCP, Azure errors and misconfigurations',
      cmds: ['diagnose <file>', 'diagnose --stdin', 'history', 'providers'],
    },
    {
      name: 'k8s',
      color: chalk.blue,
      desc: 'Kubernetes pods, events, node issues',
      cmds: ['debug <file>', 'debug --stdin', 'status', 'pods', 'errors'],
    },
    {
      name: 'ci',
      color: chalk.hex('#f9ca24'),
      desc: 'GitHub Actions, GitLab CI, Jenkins, CircleCI failures',
      cmds: ['analyze <file>', 'analyze --stdin', 'analyze --run <id>'],
    },
    {
      name: 'explain',
      color: chalk.hex('#a29bfe'),
      desc: 'Explain any error, K8s state, CVE, or DevOps concept',
      cmds: ['CrashLoopBackOff', '"CVE-2024-1234"', 'ETIMEDOUT'],
    },
    {
      name: 'watch',
      color: chalk.hex('#fd79a8'),
      desc: 'Tail a log or command — auto-analyze errors live',
      cmds: ['<logfile>', '"kubectl logs -f <pod>"', '<source> --notify slack'],
    },
    {
      name: 'status',
      color: chalk.cyan,
      desc: 'Live dashboard — pods, pipelines, helm releases',
      cmds: ['', '-n <namespace>', '--only k8s', '--only pipelines'],
    },
    {
      name: 'autopilot',
      color: chalk.hex('#00b894'),
      desc: 'Self-healing — watch cluster and auto-fix issues',
      cmds: ['-n <namespace>', '--auto', '--dry-run', '--once'],
    },
    {
      name: 'predict',
      color: chalk.hex('#fd79a8'),
      desc: 'Predict OOMKills, disk exhaustion before they happen',
      cmds: ['-n <namespace>', '--threshold 80', '--ai'],
    },
    {
      name: 'blame',
      color: chalk.hex('#fdcb6e'),
      desc: 'Correlate what changed before a breakage',
      cmds: ['--since 1h', '--since 30m -n production', '--no-ai'],
    },
    {
      name: 'noise',
      color: chalk.hex('#636e72'),
      desc: 'Identify noisy alerts and reduce alert fatigue',
      cmds: ['', '--alertmanager http://localhost:9093', '--days 30 --ai'],
    },
    {
      name: 'incident',
      color: chalk.hex('#e17055'),
      desc: 'Full incident commander — start, track, postmortem',
      cmds: ['start --title "..." --severity critical', 'update <id> --note "..."', 'close <id> --resolution "..."', 'postmortem <id>'],
    },
  ];

  tools.forEach(({ name, color, desc, cmds }) => {
    console.log(`\n  ${color.bold('nxs ' + name)}  ${chalk.dim(desc)}`);
    cmds.forEach((cmd) => {
      console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs ' + name + ' ' + cmd)}`);
    });
  });

  console.log(chalk.dim('\n  ── Global ───────────────────────────────────────────'));
  console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs config --setup')}    ${chalk.dim('Set up API keys')}`);
  console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs history')}           ${chalk.dim('All past analyses')}`);
  console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs update')}            ${chalk.dim('Check for latest version')}`);
  console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs <tool> --help')}     ${chalk.dim('Help for any tool')}`);

  console.log('\n' + hr() + '\n');
  process.exit(0);
}

program.parse();
