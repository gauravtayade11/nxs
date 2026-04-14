#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config }  from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';

import { applyConfig, loadConfig, saveConfig, loadHistory, CONFIG_FILE, HISTORY_FILE } from './core/config.js';
import { printBanner, providerInfo, hr, promptSecret, VERSION } from './core/ui.js';
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

    const div  = chalk.dim('─'.repeat(60));
    const head = (t) => console.log(`\n  ${chalk.bold.white(t)}\n`);

    // ── What it does ──────────────────────────────────────────────────────────
    console.log(div);
    console.log(`
  ${chalk.white('Paste any DevOps error — get root cause + fix command in seconds.')}

  ${chalk.dim('Engine:')}  Rule engine (instant) → AI fallback (Groq / Claude)
  ${chalk.dim('Output:')}  Summary · Confidence score · Impact · Root cause · Fix · Suggestions
  ${chalk.dim('Extras:')}  Slack alerts · REST API · CI/CD integration · Pattern history
`);

    // ── AI provider status ────────────────────────────────────────────────────
    const p = providerInfo();
    console.log(`  ${chalk.dim('Active provider:')}  ${p.badge(p.label)}  ${chalk.dim(p.name)}`);
    console.log(chalk.dim('  No key? Demo mode works — rule engine covers the top 20 errors offline.\n'));
    console.log(div);

    // ── Core tools ────────────────────────────────────────────────────────────
    head('🔧  Core Debugging');

    const coreTools = [
      {
        name: 'nxs k8s', color: chalk.blue,
        tag: 'Kubernetes', badge: chalk.bgBlue.white,
        cmds: [
          ['debug --pod <name> -n <ns>',    'Auto-fetch logs + describe, no piping needed'],
          ['debug --stdin / <file>',        'Analyze any pod log, event, or describe output'],
          ['events [-n ns] [--warnings-only]', 'Cluster-wide event triage with grouping'],
          ['status / pods [--watch]',       'Live pod health dashboard'],
          ['errors',                        'Reference card: CrashLoopBackOff, OOMKilled, etc.'],
        ],
      },
      {
        name: 'nxs ci', color: chalk.hex('#f9ca24'),
        tag: 'CI/CD', badge: chalk.bgHex('#f9ca24').black,
        cmds: [
          ['analyze --latest',              'Auto-fetch most recent failed GitHub Actions run'],
          ['analyze --run <id>',            'Fetch a specific run via gh CLI'],
          ['analyze <file/--stdin>',        'Analyze GitHub Actions, GitLab CI, Jenkins, CircleCI'],
          ['analyze --fail-on critical',    'Gate your pipeline — exit 1 on critical severity'],
        ],
      },
      {
        name: 'nxs devops', color: chalk.yellow,
        tag: 'Docker · Terraform', badge: chalk.bgYellow.black,
        cmds: [
          ['analyze <file/--stdin>',        'Docker builds, Terraform, general pipeline errors'],
          ['pipelines [--watch]',           'GitHub Actions run status — live refresh'],
        ],
      },
    ];

    coreTools.forEach(({ name, color, tag: t, cmds }) => {
      console.log(`  ${color.bold(name)}  ${chalk.dim(t)}`);
      cmds.forEach(([cmd, desc]) => {
        console.log(`    ${chalk.dim('›')} ${chalk.cyan((name + ' ' + cmd).padEnd(42))} ${chalk.hex('#64748b')(desc)}`);
      });
      console.log('');
    });

    // ── Security & Reliability ────────────────────────────────────────────────
    console.log(div);
    head('🔐  Security & Reliability');

    const reliabilityTools = [
      {
        name: 'nxs predict', color: chalk.hex('#fd79a8'),
        cmds: [
          ['[-n ns] [--threshold 80]',      'Detect at-risk pods before they crash'],
          ['--watch [--interval 2]',        'Continuous monitor — alerts on new risks'],
          ['--ai',                          'AI deep-dive failure timeline'],
        ],
      },
      {
        name: 'nxs autopilot', color: chalk.hex('#00b894'),
        cmds: [
          ['-n <ns> [--auto]',              'Self-heal crashed pods, bump OOMKilled memory'],
          ['--dry-run',                     'Preview what would be fixed without applying'],
        ],
      },
      {
        name: 'nxs sec', color: chalk.hex('#ff4757'),
        cmds: [
          ['scan --image <name>',           'Scan a Docker image for CVEs (requires trivy)'],
          ['cluster [-n ns] [--detailed]',  'Scan all running images in the cluster'],
          ['scan <file/--stdin>',           'Analyze Trivy, Grype, Snyk, OWASP output'],
        ],
      },
      {
        name: 'nxs rbac', color: chalk.hex('#e17055'),
        cmds: [
          ['scan [--fail-on critical]',     'Audit cluster RBAC — wildcards, anonymous, cluster-admin'],
        ],
      },
    ];

    reliabilityTools.forEach(({ name, color, cmds }) => {
      console.log(`  ${color.bold(name)}`);
      cmds.forEach(([cmd, desc]) => {
        console.log(`    ${chalk.dim('›')} ${chalk.cyan((name + ' ' + cmd).padEnd(42))} ${chalk.hex('#64748b')(desc)}`);
      });
      console.log('');
    });

    // ── Monitoring & Incidents ────────────────────────────────────────────────
    console.log(div);
    head('📡  Monitoring & Incidents');

    const monTools = [
      {
        name: 'nxs watch', color: chalk.hex('#a29bfe'),
        cmds: [
          ['"kubectl logs -f <pod>"',       'Stream any command — AI on every error line'],
          ['<logfile> --severity critical', 'Only trigger AI on FATAL/OOM/panic events'],
          ['<source> --notify slack',       'Post Slack alert on every detected error'],
        ],
      },
      {
        name: 'nxs incident', color: chalk.hex('#e17055'),
        cmds: [
          ['start --title "..." --severity critical', 'Open incident + auto-post to Slack'],
          ['update <id> --note "..."',      'Add timeline update (threads in Slack)'],
          ['close <id> --resolution "..."', 'Resolve + post resolution to Slack'],
          ['postmortem <id> [--output md]', 'AI-generated postmortem with prevention items'],
        ],
      },
      {
        name: 'nxs status', color: chalk.cyan,
        cmds: [
          ['[--only k8s|pipelines|helm]',   'Live dashboard — cluster + CI + Helm releases'],
        ],
      },
    ];

    monTools.forEach(({ name, color, cmds }) => {
      console.log(`  ${color.bold(name)}`);
      cmds.forEach(([cmd, desc]) => {
        console.log(`    ${chalk.dim('›')} ${chalk.cyan((name + ' ' + cmd).padEnd(42))} ${chalk.hex('#64748b')(desc)}`);
      });
      console.log('');
    });

    // ── Infrastructure ────────────────────────────────────────────────────────
    console.log(div);
    head('🌐  Infrastructure');

    const infraTools = [
      { name: 'nxs cloud',   color: chalk.hex('#FF9900'), desc: 'AWS · GCP · Azure IAM and API errors' },
      { name: 'nxs net',     color: chalk.hex('#00b4d8'), desc: 'DNS · TLS · timeouts · HTTP failures  (--check <host>  --cert <host>)' },
      { name: 'nxs db',      color: chalk.hex('#f4a261'), desc: 'PostgreSQL · MySQL · MongoDB · Redis errors' },
      { name: 'nxs explain', color: chalk.hex('#a29bfe'), desc: 'Plain-English explainer for any error, CVE, or DevOps term' },
    ];

    infraTools.forEach(({ name, color, desc }) => {
      console.log(`  ${color.bold(name.padEnd(14))} ${chalk.hex('#64748b')(desc)}`);
    });
    console.log('');

    // ── Integrations ─────────────────────────────────────────────────────────
    console.log(div);
    head('🔗  Integrations');

    console.log(`  ${chalk.hex('#00cec9').bold('nxs serve --port 4000')}  ${chalk.dim('REST API for team + CI/CD')}`);
    const endpoints = [
      ['POST /analyze',              'Any log → structured analysis JSON'],
      ['POST /webhook/alertmanager', 'Prometheus alert → AI diagnosis → Slack'],
      ['POST /webhook/github',       'CI failure → AI diagnosis → Slack'],
      ['GET  /history / /report',    'Past analyses + digest'],
    ];
    endpoints.forEach(([ep, desc]) => {
      console.log(`    ${chalk.dim('›')} ${chalk.cyan(ep.padEnd(32))} ${chalk.hex('#64748b')(desc)}`);
    });
    console.log('');

    // ── Quick-start one-liners ────────────────────────────────────────────────
    console.log(div);
    head('⚡  Quick-start one-liners');

    const examples = [
      ['Debug crashing pod',            'kubectl logs my-pod --previous | nxs k8s debug --stdin'],
      ['Instant diagnosis (no API key)','kubectl logs my-pod --previous | nxs k8s debug --stdin --fast'],
      ['Debug + Slack alert',           'kubectl logs my-pod --previous | nxs k8s debug --stdin --notify slack'],
      ['Latest CI failure',             'nxs ci analyze --latest'],
      ['Gate CI on severity',           'nxs ci analyze build.log --fail-on critical'],
      ['Predict pod failures',          'nxs predict -n production --watch'],
      ['Scan cluster for CVEs',         'nxs sec cluster -n production --detailed'],
      ['Watch live pod logs',           'nxs watch "kubectl logs -f deploy/my-app" --severity critical'],
      ['Open an incident',              'nxs incident start --title "API down" --severity critical'],
      ['Test offline (no cluster)',     'nxs test crashloop'],
      ['Full infra snapshot',           'nxs status'],
      ['Weekly digest → Slack',         'nxs report --days 7 --notify slack'],
    ];

    examples.forEach(([label, cmd]) => {
      console.log(`  ${chalk.dim('›')} ${chalk.hex('#64748b')(label.padEnd(32))} ${chalk.cyan(cmd)}`);
    });

    // ── Global commands ───────────────────────────────────────────────────────
    console.log('\n' + div);
    head('🛠   Global Commands');

    const globals = [
      ['nxs test --list',           'List all 10 built-in test scenarios (offline, no cluster needed)'],
      ['nxs test <scenario>',       'Run a scenario through the full pipeline — great for demos'],
      ['nxs history',               'All past analyses across every tool'],
      ['nxs history --search oom',  'Search history by keyword'],
      ['nxs report --days 7',       'Weekly digest with severity breakdown by tool'],
      ['nxs config --setup',        'Interactive wizard — add Groq or Claude API key'],
      ['nxs update',                'Check for latest version on npm'],
    ];

    globals.forEach(([cmd, desc]) => {
      console.log(`  ${chalk.cyan(cmd.padEnd(32))} ${chalk.dim(desc)}`);
    });

    // ── Universal flags ───────────────────────────────────────────────────────
    console.log('\n' + div);
    head('🚩  Universal Flags  (work on every analyze/debug/diagnose command)');

    const flags = [
      ['--fast',               'Rules engine only — instant, zero API calls, works offline'],
      ['--notify slack',       'Post result to Slack after analysis'],
      ['--fail-on critical',   'Exit code 1 if severity matches (use in CI/CD gates)'],
      ['-o, --output <file>',  'Save full analysis as a markdown report'],
      ['--redact',             'Scrub secrets/tokens before sending to AI'],
      ['-j, --json',           'Structured JSON output for scripting'],
      ['--chat',               'Enable follow-up Q&A after analysis (opt-in)'],
    ];

    flags.forEach(([flag, desc]) => {
      console.log(`  ${chalk.yellow(flag.padEnd(24))} ${chalk.dim(desc)}`);
    });

    console.log('\n' + div + '\n');
  });

// ── nxs test ─────────────────────────────────────────────────────────────────

program
  .command('test [scenario]')
  .description('Run a built-in test scenario through the full analysis pipeline')
  .option('--list', 'List all available test scenarios')
  .option('-j, --json', 'Output as JSON')
  .addHelpText('after', `
Scenarios:
  crashloop    Kubernetes CrashLoopBackOff
  oomkilled    Kubernetes OOMKilled (exit code 137)
  imagepull    Kubernetes ImagePullBackOff
  pending      Kubernetes pod stuck in Pending
  evicted      Kubernetes pod evicted (node pressure)
  rbac         Kubernetes RBAC forbidden
  ci-npm       npm test failure in GitHub Actions
  ci-docker    Docker registry auth failure
  ci-module    ModuleNotFoundError in CI
  ci-timeout   CI step timeout

Examples:
  $ nxs test crashloop
  $ nxs test ci-npm
  $ nxs test --list
  $ nxs test crashloop --json`)
  .action(async (scenario, opts) => {
    const { matchRule, RULES } = await import('./core/rules.js');
    const { printResult } = await import('./core/ui.js');

    const SCENARIOS = {
      'crashloop': {
        label: 'Kubernetes CrashLoopBackOff',
        log: `Warning  BackOff    2m    kubelet  Back-off restarting failed container
Normal   Pulled     2m    kubelet  Successfully pulled image "my-app:latest"
Warning  Failed     2m    kubelet  Error: failed to create containerd task: CrashLoopBackOff
Error from server: container "my-app" in pod "my-app-7d4f9b5-xk2p9" is waiting to start: CrashLoopBackOff`,
      },
      'oomkilled': {
        label: 'Kubernetes OOMKilled',
        log: `Last State: Terminated
  Reason:    OOMKilled
  Exit Code: 137
  Started:   Mon, 12 Apr 2026 10:22:14 +0000
  Finished:  Mon, 12 Apr 2026 10:22:51 +0000
Limits:
  memory: 256Mi
Requests:
  memory: 128Mi`,
      },
      'imagepull': {
        label: 'Kubernetes ImagePullBackOff',
        log: `Warning  Failed    45s   kubelet  Failed to pull image "private-registry.example.com/my-app:v2.1.0": rpc error: code = Unknown desc = pull access denied for private-registry.example.com/my-app, repository does not exist or may require 'docker login': denied: access forbidden
Warning  Failed    45s   kubelet  Error: ErrImagePull
Warning  BackOff   30s   kubelet  Back-off pulling image "private-registry.example.com/my-app:v2.1.0"
Warning  Failed    30s   kubelet  Error: ImagePullBackOff`,
      },
      'pending': {
        label: 'Kubernetes Pod Pending',
        log: `Status:         Pending
Events:
  Warning  FailedScheduling  65s   default-scheduler  0/3 nodes are available: 1 Insufficient cpu, 2 Insufficient memory. preemption: 0/3 nodes are available: 3 No preemption victims found for incoming pod.`,
      },
      'evicted': {
        label: 'Kubernetes Pod Evicted',
        log: `Status:    Failed
Reason:    Evicted
Message:   The node was low on resource: memory. Threshold quantity: 100Mi, available: 48Mi. Container my-app was using 210Mi, request is 64Mi, limit is 256Mi.
Events:
  Warning  Evicted   5s    kubelet  The node was low on resource: memory. DiskPressure condition is True.`,
      },
      'rbac': {
        label: 'Kubernetes RBAC Forbidden',
        log: `Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:production:my-app" cannot list resource "pods" in API group "" in the namespace "production"
RBAC: access denied`,
      },
      'ci-npm': {
        label: 'CI: npm test failure',
        log: `Run npm test
  npm test
  shell: /usr/bin/bash -e {0}
FAIL src/auth/auth.service.spec.ts
  ● AuthService › login › should return 401 for invalid credentials
    expect(received).toBe(expected)
    Expected: 401
    Received: 500
Tests Suites: 1 failed, 3 passed, 4 total
Tests:         1 failed, 42 passed, 43 total
Process completed with exit code 1`,
      },
      'ci-docker': {
        label: 'CI: Docker registry auth failure',
        log: `Run docker push my-registry.example.com/my-app:latest
Error response from daemon: unauthorized: authentication required
Error: Process completed with exit code 1`,
      },
      'ci-module': {
        label: 'CI: ModuleNotFoundError',
        log: `Run python -m pytest tests/
ModuleNotFoundError: No module named 'requests_toolbelt'
ERROR tests/test_api.py - ModuleNotFoundError: No module named 'requests_toolbelt'
Process completed with exit code 1`,
      },
      'ci-timeout': {
        label: 'CI: Step timeout',
        log: `Run npm run integration-tests
...
Error: The operation was canceled.
##[error]The job running on runner GitHub Actions 11 has exceeded the maximum execution time of 360 minutes.
##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.`,
      },
    };

    if (opts.list) {
      if (!opts.json) {
        printBanner('Test mode');
        console.log(hr());
        console.log(chalk.bold('\n  Available test scenarios:\n'));
        Object.entries(SCENARIOS).forEach(([key, s]) => {
          console.log(`  ${chalk.cyan(key.padEnd(14))} ${chalk.dim(s.label)}`);
        });
        console.log(chalk.dim('\n  Usage: nxs test <scenario>\n'));
      } else {
        console.log(JSON.stringify(Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label })), null, 2));
      }
      return;
    }

    if (!scenario) {
      console.error(chalk.red('  Provide a scenario name. Run: nxs test --list\n'));
      process.exit(1);
    }

    const sc = SCENARIOS[scenario.toLowerCase()];
    if (!sc) {
      console.error(chalk.red(`  Unknown scenario: "${scenario}". Run: nxs test --list\n`));
      process.exit(1);
    }

    const result = matchRule(sc.log);

    if (!result) {
      console.error(chalk.red(`  No rule matched for scenario "${scenario}". This is unexpected.\n`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ scenario, label: sc.label, ...result }, null, 2));
      return;
    }

    printBanner('Test mode');
    console.log(chalk.dim(`  Scenario: ${chalk.white(scenario)}  —  ${sc.label}\n`));
    console.log(chalk.dim('  Sample log:\n'));
    sc.log.split('\n').slice(0, 4).forEach(l => console.log(chalk.dim('  │ ') + chalk.dim(l.slice(0, 100))));
    console.log('');

    printResult(result);
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
      const cfg = loadConfig();

      console.log(chalk.bold('  Setup wizard — press Enter to skip\n'));
      console.log(chalk.dim('  Groq (free):      https://console.groq.com'));
      console.log(chalk.dim('  Anthropic Claude: https://console.anthropic.com\n'));

      const groq = await promptSecret(`  ${chalk.yellow('GROQ_API_KEY')}       › `);
      if (groq.trim()) cfg.GROQ_API_KEY = groq.trim();

      const ant = await promptSecret(`  ${chalk.yellow('ANTHROPIC_API_KEY')} › `);
      if (ant.trim()) cfg.ANTHROPIC_API_KEY = ant.trim();

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

// ── Shell completion ──────────────────────────────────────────────────────────
program
  .command('completion <shell>')
  .description('Print shell completion script — source it to enable tab-complete')
  .addHelpText('after', `
Shells supported: bash, zsh, fish

Setup:
  bash:  source <(nxs completion bash)
         # or persist: nxs completion bash >> ~/.bashrc

  zsh:   source <(nxs completion zsh)
         # or persist: nxs completion zsh >> ~/.zshrc
         # or install: nxs completion zsh > "\${fpath[1]}/_nxs"

  fish:  nxs completion fish > ~/.config/fish/completions/nxs.fish`)
  .action((shell) => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const supported = ['bash', 'zsh', 'fish'];
    if (!supported.includes(shell)) {
      console.error(chalk.red(`  Unsupported shell: ${shell}. Supported: ${supported.join(', ')}`));
      process.exit(1);
    }
    const scriptPath = resolve(__dirname, `../scripts/completion.${shell}`);
    try {
      process.stdout.write(readFileSync(scriptPath, 'utf8'));
    } catch {
      console.error(chalk.red(`  Completion script not found: ${scriptPath}`));
      process.exit(1);
    }
  });

// ── Startup version check (fire-and-forget, once per hour) ───────────────────
let _updateAvailable = null;

async function checkForUpdate() {
  try {
    const cfg = loadConfig();
    if (Date.now() - (cfg._lastUpdateCheck ?? 0) < 60 * 60 * 1000) return;
    const res = await fetch('https://registry.npmjs.org/@nextsight/nxs-cli/latest', {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const { version: latest } = await res.json();
    cfg._lastUpdateCheck = Date.now();
    saveConfig(cfg);
    if (latest && latest !== VERSION) _updateAvailable = latest;
  } catch { /* non-fatal */ }
}

process.on('exit', () => {
  if (_updateAvailable) {
    process.stderr.write(`\n  ${chalk.cyan(`⚡ nxs v${_updateAvailable} available`)}  ${chalk.dim('npm i -g @nextsight/nxs-cli')}\n\n`);
  }
});

checkForUpdate();
program.parse();
