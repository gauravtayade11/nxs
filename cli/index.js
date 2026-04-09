#!/usr/bin/env node
import { resolve } from 'node:path';
import { config }  from 'dotenv';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import chalk from 'chalk';

import { applyConfig, loadConfig, saveConfig, loadHistory, CONFIG_FILE, HISTORY_FILE } from './core/config.js';
import { printBanner, providerInfo, hr, prompt, VERSION } from './core/ui.js';
import { registerDevops } from './tools/devops.js';
import { registerCloud }  from './tools/cloud.js';
import { registerK8s }    from './tools/k8s.js';
import { registerSec }    from './tools/sec.js';
import { registerNet }    from './tools/net.js';
import { registerDb }     from './tools/db.js';
import { registerStatus, registerK8sStatus, registerDevopsPipelines } from './tools/status.js';

// Load .env then persisted config
config({ path: resolve(process.cwd(), '.env') });
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
registerStatus(program);

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
    console.log(chalk.hex('#94a3b8')('  Two interfaces: a web app (localhost:5173) and this CLI.\n'));

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
      ['Debug a Docker build failure',  'docker build . 2>&1 | nxs devops analyze --stdin'],
      ['Debug failed GitHub Actions',   'gh run view <id> --log-failed | nxs devops analyze --stdin'],
      ['Debug an AWS error',            'aws s3 cp f.txt s3://bucket/ 2>&1 | nxs cloud diagnose --stdin'],
      ['Debug Terraform apply',         'terraform apply 2>&1 | nxs devops analyze --stdin'],
      ['Watch pods live',               'nxs k8s pods --watch'],
      ['Full infra snapshot',           'nxs status'],
      ['Scan image for CVEs',           'trivy image myapp:latest | nxs sec scan --stdin'],
      ['Diagnose network failure',      'curl -v https://api.internal 2>&1 | nxs net diagnose --stdin'],
      ['Debug DB connection error',     'kubectl logs my-db-pod | nxs db diagnose --stdin'],
    ];

    examples.forEach(([label, cmd]) => {
      console.log(`  ${chalk.dim('›')} ${chalk.hex('#64748b')(label.padEnd(30))} ${chalk.cyan(cmd)}`);
    });

    // ── Global commands ──
    console.log('\n' + hr());
    console.log(chalk.bold('\n  Global commands:\n'));

    const global_cmds = [
      ['nxs history',              'All past analyses across all tools'],
      ['nxs config --setup',       'Interactive API key wizard'],
      ['nxs config --set KEY=val', 'Set a key directly'],
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

    // ── What's not built yet ──
    console.log(hr());
    console.log(chalk.bold('\n  Possible next features:\n'));

    const next = [
      'nxs devops watch <file>   — tail a live log, auto-analyze on error',
      'nxs devops scan <dir>     — scan all .log files in a folder',
      '--output report.md        — save analysis to file',
      'Slack/webhook alert       — post result after CI failure',
      'nxs sec                   — Trivy/Grype scan output analysis',
      'nxs net                   — DNS, cert expiry, connectivity diagnosis',
    ];

    next.forEach((n) => console.log(chalk.dim('  › ') + chalk.hex('#64748b')(n)));
    console.log('');
    console.log(hr() + '\n');
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
  .option('-j, --json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ nxs history
  $ nxs history -n 5
  $ nxs history --clear`)
  .action(async (opts) => {
    if (opts.clear) {
      const { saveHistory } = await import('./core/config.js');
      saveHistory([]);
      console.log(chalk.green('  ✓ All history cleared.\n'));
      return;
    }

    const entries = loadHistory().slice(0, Number.parseInt(opts.limit, 10));
    if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }

    printBanner();

    if (entries.length === 0) {
      console.log(chalk.dim('  No history yet. Try: nxs devops analyze error.log\n'));
      return;
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
        const idx = chalk.dim(`${i + 1}.`);
        const tool = chalk.bold.white(e.tool ?? 'unknown');
        const ts = chalk.dim(date);
        console.log(`\n  ${idx} ${tool}  ${ts}`);
        console.log(`     ${chalk.hex('#94a3b8')(e.summary)}`);
      });
      console.log('\n' + hr());
    });

    console.log(chalk.dim(`\n  History file: ${HISTORY_FILE}\n`));
  });

// ── Welcome screen (no args) ───────────────────────────────────────────────

if (process.argv.slice(2).length === 0) {
  printBanner();
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
      name: 'status',
      color: chalk.cyan,
      desc: 'Live dashboard — pods, pipelines, helm releases',
      cmds: ['', '-n <namespace>', '--only k8s', '--only pipelines'],
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
  console.log(`    ${chalk.dim('›')} ${chalk.cyan('nxs <tool> --help')}     ${chalk.dim('Help for any tool')}`);

  console.log('\n' + hr() + '\n');
  process.exit(0);
}

program.parse();
