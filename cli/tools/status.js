/**
 * nxs status  — live dashboard: pods, pipelines, helm releases, nodes
 * nxs k8s status / nxs devops pipelines are aliases into the same code
 */
import chalk from 'chalk';
import ora   from 'ora';
import { run, hasBin, parseTable } from '../core/exec.js';
import { printBanner, hr }         from '../core/ui.js';
import { loadConfig }              from '../core/config.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  Running:    chalk.green,
  Completed:  chalk.dim,
  Pending:    chalk.yellow,
  Failed:     chalk.red,
  Evicted:    chalk.red,
  Unknown:    chalk.gray,
  Ready:      chalk.green,
  NotReady:   chalk.red,
  deployed:   chalk.green,
  failed:     chalk.red,
  superseded: chalk.dim,
  pending:    chalk.yellow,
  success:    chalk.green,
  failure:    chalk.red,
  cancelled:  chalk.gray,
  in_progress:chalk.cyan,
  queued:     chalk.yellow,
  skipped:    chalk.dim,
};

function colorStatus(status) {
  const fn = STATUS_COLORS[status] ?? chalk.white;
  return fn(status);
}

function badge(count, fn = chalk.white) {
  return fn.bold(String(count).padStart(4));
}

function sectionHeader(title, icon) {
  console.log(`\n${icon}  ${chalk.bold.white(title)}`);
  console.log(hr());
}

// ── Kubernetes ─────────────────────────────────────────────────────────────

export async function fetchK8sStatus(namespace = null) {
  const ns = namespace ? `-n ${namespace}` : '--all-namespaces';

  const [nodesR, podsR, deploymentsR, eventsR] = await Promise.all([
    run('kubectl get nodes -o wide 2>/dev/null'),
    run(`kubectl get pods ${ns} 2>/dev/null`),
    run(`kubectl get deployments ${ns} 2>/dev/null`),
    run(`kubectl get events ${ns} --field-selector type=Warning --sort-by='.metadata.creationTimestamp' 2>/dev/null`),
  ]);

  const pods        = nodesR.ok    ? parseTable(podsR.stdout)        : [];
  const nodes       = nodesR.ok    ? parseTable(nodesR.stdout)       : [];
  const deployments = deploymentsR.ok ? parseTable(deploymentsR.stdout) : [];
  const events      = eventsR.ok   ? eventsR.stdout.split('\n').slice(1, 6) : [];

  return { pods, nodes, deployments, events, available: nodesR.ok };
}

export async function printK8sStatus(namespace = null) {
  const spin = ora({ text: 'Fetching cluster status...', color: 'cyan' }).start();
  const data = await fetchK8sStatus(namespace);
  spin.stop();

  if (!data.available) {
    console.log(chalk.yellow('\n  ⚠  kubectl not configured or cluster unreachable.'));
    console.log(chalk.dim('     Run: kubectl config view  to check your context\n'));
    return;
  }

  // ── Nodes ──
  sectionHeader('NODES', '🖥 ');
  if (data.nodes.length === 0) {
    console.log(chalk.dim('  No nodes found.'));
  } else {
    const ready    = data.nodes.filter((n) => n.status === 'Ready').length;
    const notReady = data.nodes.length - ready;
    console.log(
      `  Total: ${chalk.bold(data.nodes.length)}   ` +
      chalk.green(`✓ Ready: ${ready}  `) +
      (notReady > 0 ? chalk.red(`✗ NotReady: ${notReady}`) : '')
    );
    console.log('');
    data.nodes.forEach((n) => {
      console.log(
        `  ${colorStatus(n.status).padEnd(14)}  ${chalk.white(n.name ?? n.node ?? '')}` +
        chalk.dim(`  ${n.version ?? ''}  ${n.internal_ip ?? ''}`)
      );
    });
  }

  // ── Pods ──
  sectionHeader('PODS', '📦');
  if (data.pods.length === 0) {
    console.log(chalk.dim('  No pods found.'));
  } else {
    const counts = {};
    data.pods.forEach((p) => {
      const s = p.status ?? 'Unknown';
      counts[s] = (counts[s] ?? 0) + 1;
    });

    // Summary bar
    console.log(
      `  Total: ${chalk.bold(data.pods.length)}   ` +
      Object.entries(counts).map(([s, n]) => colorStatus(s) + chalk.dim(`: ${n}`)).join('   ')
    );
    console.log('');

    // Unhealthy pods first, then running
    const unhealthy = data.pods.filter((p) => !['Running', 'Completed'].includes(p.status));
    const healthy   = data.pods.filter((p) =>  ['Running', 'Completed'].includes(p.status));

    if (unhealthy.length > 0) {
      console.log(chalk.red.bold('  ⚠ Unhealthy:'));
      unhealthy.forEach((p) => {
        console.log(
          `  ${colorStatus(p.status ?? 'Unknown').padEnd(20)}  ${chalk.white(p.name ?? '')}` +
          chalk.dim(`  restarts:${p.restarts ?? '0'}`)
        );
      });
      console.log('');
    }

    console.log(chalk.dim(`  Running (${healthy.length}):`));
    healthy.slice(0, 10).forEach((p) => {
      console.log(
        `  ${chalk.green('●')}  ${chalk.white((p.name ?? '').padEnd(45))}` +
        chalk.dim(`ready:${p.ready ?? '-'}`)
      );
    });
    if (healthy.length > 10) console.log(chalk.dim(`  ... and ${healthy.length - 10} more`));
  }

  // ── Deployments ──
  sectionHeader('DEPLOYMENTS', '🚀');
  if (data.deployments.length === 0) {
    console.log(chalk.dim('  No deployments found.'));
  } else {
    const healthy = data.deployments.filter((d) => d.ready && d.ready.split('/')[0] === d.ready.split('/')[1]).length;
    console.log(`  Total: ${chalk.bold(data.deployments.length)}   ${chalk.green(`✓ Healthy: ${healthy}`)}   ${chalk.yellow(`⚠ Degraded: ${data.deployments.length - healthy}`)}\n`);
    data.deployments.forEach((d) => {
      const [avail, desired] = (d.ready ?? '0/0').split('/');
      const ok = avail === desired;
      console.log(
        `  ${ok ? chalk.green('✓') : chalk.red('✗')}  ${chalk.white((d.name ?? '').padEnd(40))}` +
        chalk.dim(`${d.ready ?? '-'} ready  up-to-date:${d.up_to_date ?? '-'}`)
      );
    });
  }

  // ── Warning Events ──
  if (data.events.length > 0) {
    sectionHeader('RECENT WARNINGS', '⚠ ');
    data.events.forEach((e) => console.log(chalk.yellow('  ' + e)));
  }

  console.log('\n' + hr() + '\n');
}

// ── GitHub Actions pipelines ───────────────────────────────────────────────

export async function fetchPipelines(repo = null) {
  // Try gh CLI first
  const ghOk = await hasBin('gh');

  if (ghOk) {
    const repoFlag = repo ? `-R ${repo}` : '';
    const r = await run(`gh run list ${repoFlag} --limit 20 --json name,status,conclusion,headBranch,createdAt,url 2>/dev/null`);
    if (r.ok && r.stdout) {
      try { return { runs: JSON.parse(r.stdout), source: 'gh', repo }; } catch {}
    }

    // Detect repo from git remote
    if (!repo) {
      const remoteR = await run('git remote get-url origin 2>/dev/null');
      if (remoteR.ok) {
        const match = remoteR.stdout.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
        if (match) {
          const detectedRepo = match[1];
          const r2 = await run(`gh run list -R ${detectedRepo} --limit 20 --json name,status,conclusion,headBranch,createdAt,url 2>/dev/null`);
          if (r2.ok && r2.stdout) {
            try { return { runs: JSON.parse(r2.stdout), source: 'gh', repo: detectedRepo }; } catch {}
          }
        }
      }
    }
  }

  // Try GitHub API with token from config
  const cfg = loadConfig();
  const token = process.env.GITHUB_TOKEN || cfg.GITHUB_TOKEN;
  if (token && repo) {
    const r = await run(
      `curl -s -H "Authorization: Bearer ${token}" ` +
      `"https://api.github.com/repos/${repo}/actions/runs?per_page=20"`
    );
    if (r.ok) {
      try {
        const data = JSON.parse(r.stdout);
        return { runs: data.workflow_runs ?? [], source: 'api', repo };
      } catch {}
    }
  }

  return { runs: [], source: 'none', repo };
}

export async function printPipelines(repo = null) {
  const spin = ora({ text: 'Fetching pipeline status...', color: 'cyan' }).start();
  const data = await fetchPipelines(repo);
  spin.stop();

  if (data.source === 'none' || data.runs.length === 0) {
    console.log(chalk.yellow('\n  ⚠  No pipelines found.'));
    console.log(chalk.dim('     Make sure you are inside a GitHub repo, or run:'));
    console.log(chalk.dim('     gh auth login\n'));
    return;
  }

  const runs = data.runs;

  // Count by status/conclusion
  const running   = runs.filter((r) => r.status === 'in_progress').length;
  const queued    = runs.filter((r) => r.status === 'queued').length;
  const success   = runs.filter((r) => r.conclusion === 'success').length;
  const failed    = runs.filter((r) => r.conclusion === 'failure').length;
  const cancelled = runs.filter((r) => r.conclusion === 'cancelled').length;

  sectionHeader(`PIPELINES${data.repo ? '  ' + chalk.dim(data.repo) : ''}`, '🔄');
  console.log(
    `  Total: ${chalk.bold(runs.length)}   ` +
    chalk.cyan(`⟳ Running: ${running}  `) +
    chalk.yellow(`⧗ Queued: ${queued}  `) +
    chalk.green(`✓ Success: ${success}  `) +
    chalk.red(`✗ Failed: ${failed}  `) +
    chalk.dim(`⊘ Cancelled: ${cancelled}`)
  );
  console.log('');

  // Active runs first
  const active  = runs.filter((r) => ['in_progress', 'queued'].includes(r.status));
  const recent  = runs.filter((r) => !['in_progress', 'queued'].includes(r.status));

  if (active.length > 0) {
    console.log(chalk.cyan.bold('  ⟳ Active:'));
    active.forEach((r) => {
      const branch = r.headBranch ?? r.head_branch ?? '';
      const name   = r.name ?? r.workflow ?? '';
      console.log(
        `    ${chalk.cyan('●')}  ${chalk.white(name.padEnd(35))}` +
        chalk.yellow(`[${r.status}]`) + chalk.dim(`  ${branch}`)
      );
    });
    console.log('');
  }

  console.log(chalk.dim('  Recent:'));
  recent.slice(0, 12).forEach((r) => {
    const conclusion = r.conclusion ?? r.status ?? 'unknown';
    const icon = conclusion === 'success' ? chalk.green('✓') :
                 conclusion === 'failure' ? chalk.red('✗') :
                 conclusion === 'cancelled' ? chalk.dim('⊘') : chalk.yellow('?');
    const name   = (r.name ?? r.workflow ?? '').padEnd(35);
    const branch = r.headBranch ?? r.head_branch ?? '';
    const date   = r.createdAt ?? r.created_at ?? '';
    const ago    = date ? chalk.dim(formatAgo(date)) : '';
    console.log(`    ${icon}  ${chalk.white(name)}${chalk.dim(branch.padEnd(20))}  ${ago}`);
  });

  console.log('\n' + hr() + '\n');

  // Suggest debug on failed
  const failedRuns = recent.filter((r) => r.conclusion === 'failure');
  if (failedRuns.length > 0) {
    console.log(chalk.red.bold(`  ⚠  ${failedRuns.length} failed pipeline(s) — run to debug:`));
    failedRuns.slice(0, 3).forEach((r) => {
      const id = r.databaseId ?? r.id ?? '';
      if (id) console.log(chalk.dim(`     gh run view ${id} --log-failed | nxs devops analyze --stdin`));
    });
    console.log('');
  }
}

// ── Helm releases ──────────────────────────────────────────────────────────

export async function printHelmStatus() {
  const helmOk = await hasBin('helm');
  if (!helmOk) return;

  const spin = ora({ text: 'Fetching Helm releases...', color: 'cyan' }).start();
  const r = await run('helm list --all-namespaces 2>/dev/null');
  spin.stop();

  if (!r.ok || !r.stdout) return;

  const releases = parseTable(r.stdout);
  if (releases.length === 0) return;

  sectionHeader('HELM RELEASES', '⎈ ');

  const deployed   = releases.filter((r) => r.status === 'deployed').length;
  const failed     = releases.filter((r) => r.status === 'failed').length;
  console.log(
    `  Total: ${chalk.bold(releases.length)}   ` +
    chalk.green(`✓ Deployed: ${deployed}  `) +
    (failed > 0 ? chalk.red(`✗ Failed: ${failed}`) : '')
  );
  console.log('');

  releases.forEach((rel) => {
    const statusFn = STATUS_COLORS[rel.status] ?? chalk.white;
    console.log(
      `  ${statusFn('●')}  ${chalk.white((rel.name ?? '').padEnd(30))}` +
      statusFn((rel.status ?? '').padEnd(12)) +
      chalk.dim(`${rel.chart ?? ''}  ns:${rel.namespace ?? ''}`)
    );
  });

  console.log('\n' + hr());
}

// ── Unified dashboard ──────────────────────────────────────────────────────

export async function printDashboard(opts = {}) {
  const sections = opts.only ? opts.only.split(',') : ['k8s', 'pipelines', 'helm'];

  if (sections.includes('k8s'))       await printK8sStatus(opts.namespace);
  if (sections.includes('pipelines')) await printPipelines(opts.repo);
  if (sections.includes('helm'))      await printHelmStatus();
}

// ── Time helper ────────────────────────────────────────────────────────────

function formatAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Register commands ──────────────────────────────────────────────────────

export function registerStatus(program) {
  // Top-level: nxs status
  program
    .command('status')
    .description('Live dashboard — pods, pipelines, helm releases')
    .option('-n, --namespace <ns>', 'Kubernetes namespace (default: all)')
    .option('-r, --repo <owner/repo>', 'GitHub repo (default: detected from git remote)')
    .option('--only <sections>', 'Show only: k8s,pipelines,helm (comma-separated)')
    .addHelpText('after', `
Examples:
  $ nxs status                        full dashboard
  $ nxs status -n production          pods in production namespace
  $ nxs status --only pipelines       pipelines only
  $ nxs status -r myorg/myrepo        specific GitHub repo`)
    .action(async (opts) => {
      printBanner('Live infrastructure dashboard');
      await printDashboard(opts);
      console.log(chalk.dim('  Tip: pipe failed logs → nxs k8s debug / nxs devops analyze\n'));
    });

  // nxs k8s status  (added to k8s subcommand externally)
  // nxs devops pipelines  (added to devops subcommand externally)
}

export function registerK8sStatus(k8sCommand) {
  k8sCommand
    .command('status')
    .description('Cluster overview — nodes, pods, deployments')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .addHelpText('after', `
Examples:
  $ nxs k8s status
  $ nxs k8s status -n production
  $ nxs k8s status -n kube-system`)
    .action(async (opts) => {
      printBanner('Kubernetes cluster status');
      await printK8sStatus(opts.namespace);
    });

  k8sCommand
    .command('pods')
    .description('Pod counts and health by namespace')
    .option('-n, --namespace <ns>', 'Filter by namespace')
    .option('--watch', 'Refresh every 5 seconds')
    .addHelpText('after', `
Examples:
  $ nxs k8s pods
  $ nxs k8s pods -n default
  $ nxs k8s pods --watch`)
    .action(async (opts) => {
      printBanner('Kubernetes pod status');

      const print = async () => {
        const spin = ora({ text: 'Fetching pods...', color: 'cyan' }).start();
        const ns = opts.namespace ? `-n ${opts.namespace}` : '--all-namespaces';
        const r  = await run(`kubectl get pods ${ns} 2>/dev/null`);
        spin.stop();

        if (!r.ok) {
          console.log(chalk.yellow('  kubectl not available or cluster unreachable.\n'));
          return;
        }

        const pods = parseTable(r.stdout);
        const ns_label = opts.namespace ?? 'all namespaces';

        console.log(chalk.bold(`\n  Pods in ${ns_label}:\n`));
        console.log(hr());

        const groups = {};
        pods.forEach((p) => {
          const s = p.status ?? 'Unknown';
          if (!groups[s]) groups[s] = [];
          groups[s].push(p);
        });

        // Order: Failed first, then Pending, then Running
        const order = ['Failed', 'Evicted', 'CrashLoopBackOff', 'Pending', 'Running', 'Completed', 'Unknown'];
        const sorted = [...order.filter((s) => groups[s]), ...Object.keys(groups).filter((s) => !order.includes(s))];

        sorted.forEach((status) => {
          const list = groups[status] ?? [];
          const col  = STATUS_COLORS[status] ?? chalk.white;
          console.log(`\n  ${col.bold(`${status}`)} ${chalk.dim(`(${list.length})`)}`);
          list.forEach((p) => {
            console.log(
              `    ${col('●')}  ${chalk.white((p.name ?? '').padEnd(50))}` +
              chalk.dim(`ready:${p.ready ?? '-'}  restarts:${p.restarts ?? '0'}`)
            );
          });
        });

        console.log('\n' + hr());
        console.log(
          '\n  ' +
          Object.entries(groups).map(([s, list]) => {
            const fn = STATUS_COLORS[s] ?? chalk.white;
            return fn.bold(`${s}: ${list.length}`);
          }).join(chalk.dim('  ·  '))
        );
        console.log('');
      };

      await print();

      if (opts.watch) {
        console.log(chalk.dim('  Refreshing every 5s — Ctrl+C to stop\n'));
        setInterval(async () => {
          process.stdout.write('\x1Bc'); // clear terminal
          printBanner('Kubernetes pod status');
          await print();
        }, 5000);
      }
    });
}

export function registerDevopsPipelines(devopsCommand) {
  devopsCommand
    .command('pipelines')
    .description('GitHub Actions pipeline status')
    .option('-r, --repo <owner/repo>', 'GitHub repo (default: detected from git remote)')
    .option('--watch', 'Refresh every 30 seconds')
    .addHelpText('after', `
Examples:
  $ nxs devops pipelines
  $ nxs devops pipelines -r myorg/myrepo
  $ nxs devops pipelines --watch

Requirements:
  gh CLI installed and authenticated (gh auth login)
  OR: nxs config --set GITHUB_TOKEN=ghp_xxx`)
    .action(async (opts) => {
      printBanner('GitHub Actions pipeline status');

      const print = () => printPipelines(opts.repo);
      await print();

      if (opts.watch) {
        console.log(chalk.dim('  Refreshing every 30s — Ctrl+C to stop\n'));
        setInterval(async () => {
          process.stdout.write('\x1Bc');
          printBanner('GitHub Actions pipeline status');
          await print();
        }, 30000);
      }
    });
}
