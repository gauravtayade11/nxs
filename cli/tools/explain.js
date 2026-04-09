/**
 * nxs explain — plain-English explainer for any DevOps term, error, or CVE
 */
import chalk from 'chalk';
import ora from 'ora';
import { printBanner, hr } from '../core/ui.js';
import { analyze } from '../core/ai.js';

const SYSTEM_PROMPT = `You are a senior DevOps engineer and technical educator. The user wants a clear explanation of a term, error code, CVE, or concept.

Return a JSON object with exactly this structure:

{
  "tool": "explain",
  "severity": "info",
  "term": "<the exact term or phrase being explained>",
  "category": "<kubernetes|docker|network|security|database|cloud|ci|git|general>",
  "summary": "<what it is — one clear sentence, no jargon>",
  "rootCause": "<why it happens — 3-5 common causes, each on its own line starting with a number>",
  "fixSteps": "<how to diagnose and resolve — numbered practical steps>",
  "commands": "<useful commands to investigate, reproduce, or fix this — one per line>"
}

Cover all DevOps domains:
- Kubernetes: CrashLoopBackOff, OOMKilled, ImagePullBackOff, Pending, Evicted, NodeNotReady, PodDisruptionBudget
- Network: ETIMEDOUT, ECONNREFUSED, ENOTFOUND, NXDOMAIN, 502/504, TLS handshake failed, SNI, mTLS
- Security: CVE IDs (include CVSS score, affected packages, fix version), CVSS severity levels, CWE IDs
- Docker: layer cache miss, exec format error, no space left on device, daemon not running
- Cloud: AWS AccessDenied, ThrottlingException, InvalidClientTokenId, GCP PERMISSION_DENIED, Azure AuthorizationFailed
- Database: too many connections, lock timeout, deadlock, replica lag, max_connections, WAL
- Git: merge conflict, detached HEAD, force push rejected, shallow clone
- CI/CD: exit code 137, runner out of memory, artifact not found, cache key miss

For CVE IDs: include affected software, CVSS score if known, patched version, short mitigation.

Return ONLY valid JSON. No markdown fences.`;

const MOCK = {
  CrashLoopBackOff: {
    tool: 'explain', severity: 'info', term: 'CrashLoopBackOff', category: 'kubernetes',
    summary: 'A Kubernetes pod is repeatedly crashing and being restarted — it never stays running.',
    rootCause: '1. App exits with non-zero code (bad config, missing env var, startup error)\n2. Missing ConfigMap or Secret the container depends on\n3. OOMKilled — memory limit too low (check Exit Code 137)\n4. Liveness probe failing immediately after container starts\n5. Database or upstream dependency not ready (fix with initContainers)',
    fixSteps: '1. kubectl logs <pod> --previous — see last crash output\n2. kubectl describe pod <pod> — check Events section and Exit Code\n3. Exit code 1 = app error, 137 = OOMKilled, 2 = shell misuse\n4. Verify all env vars, Secrets, ConfigMaps are mounted\n5. Add sleep to command temporarily to keep pod alive for debugging',
    commands: 'kubectl logs <pod> --previous\nkubectl describe pod <pod>\nkubectl get events --sort-by=.metadata.creationTimestamp\nkubectl exec -it <pod> -- /bin/sh',
  },
  OOMKilled: {
    tool: 'explain', severity: 'info', term: 'OOMKilled', category: 'kubernetes',
    summary: 'The container was killed by the Linux OOM (Out-of-Memory) killer because it exceeded its memory limit.',
    rootCause: '1. Memory limit set too low for the actual workload\n2. Memory leak in the application — usage grows until killed\n3. Sudden traffic spike causing in-memory spike (caches, queues)\n4. No memory limit set — node-level OOM kill to protect the node',
    fixSteps: '1. kubectl top pod <pod> — check actual memory usage before increasing limits\n2. Increase resources.limits.memory in the deployment spec\n3. Profile the app for memory leaks (heap dumps, pprof, jmap)\n4. Set up HPA to add replicas before memory is exhausted\n5. Add memory alerts in Prometheus/Datadog before limit is hit',
    commands: 'kubectl top pod <pod>\nkubectl describe pod <pod> | grep -A3 OOM\nkubectl edit deployment <name>   # increase memory limit\nkubectl get pod <pod> -o yaml | grep -A10 resources',
  },
  ECONNREFUSED: {
    tool: 'explain', severity: 'info', term: 'ECONNREFUSED', category: 'network',
    summary: 'The TCP connection was actively rejected — the target host is up but nothing is listening on that port.',
    rootCause: '1. The service/process on the target port is not running or has crashed\n2. Firewall rule blocking the port (iptables, security group, NSG)\n3. Wrong host or port in your config\n4. Service is listening on 127.0.0.1 (localhost only) instead of 0.0.0.0\n5. Kubernetes Service selector does not match pod labels',
    fixSteps: '1. Check if the target process is running: ps aux | grep <service>\n2. Verify it is listening on the right interface: ss -tlnp | grep <port>\n3. Test from the same network: telnet <host> <port> or nc -zv <host> <port>\n4. Check firewall rules: iptables -L or cloud security groups',
    commands: 'nc -zv <host> <port>\nss -tlnp | grep <port>\nkubectl get svc && kubectl get endpoints\ncurl -v http://<host>:<port>/ 2>&1 | head -20',
  },
};

function mockExplain(input) {
  const term = input.replace(/^EXPLAIN:\s*/i, '').trim();
  const key = Object.keys(MOCK).find((k) => k.toLowerCase() === term.toLowerCase());
  if (key) return MOCK[key];
  return {
    tool: 'explain', severity: 'info', term, category: 'general',
    summary: `${term} is a DevOps error or concept that requires investigation.`,
    rootCause: '1. Check the official documentation for this specific error\n2. Verify your environment configuration matches expectations\n3. Look for recent changes that may have triggered this\n4. Search error forums and GitHub issues for this exact message',
    fixSteps: '1. Find the exact error message in your tool\'s documentation\n2. Check system logs for context around when this occurred\n3. Review recent deployments or configuration changes\n4. Narrow down by testing with minimal configuration',
    commands: '# Check system logs\njournalctl -xe --no-pager | tail -50\n# Or application logs\ntail -100 /var/log/app/error.log',
  };
}

export function registerExplain(program) {
  program
    .command('explain <term...>')
    .description('Explain any DevOps term, error code, CVE, or K8s state in plain English')
    .option('--no-chat', 'Skip follow-up chat')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs explain CrashLoopBackOff
  $ nxs explain OOMKilled
  $ nxs explain "CVE-2024-1234"
  $ nxs explain ETIMEDOUT
  $ nxs explain ImagePullBackOff
  $ nxs explain "403 Forbidden"
  $ nxs explain "connection pool exhausted"
  $ nxs explain "exit code 137"`)
    .action(async (termParts, opts) => {
      const term = termParts.join(' ');

      if (!opts.json) {
        printBanner('DevOps term explainer');
        console.log(chalk.dim(`  Explaining: ${chalk.white(term)}\n`));
      }

      const input = `EXPLAIN: ${term}`;

      if (opts.json) {
        const result = await analyze(input, SYSTEM_PROMPT, mockExplain);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const spinner = ora({ text: 'Looking it up...', color: 'cyan' }).start();
      let result;
      try {
        result = await analyze(input, SYSTEM_PROMPT, mockExplain);
        spinner.succeed(chalk.green('Done'));
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
      }

      // Custom display for explain — more readable than the generic result box
      const t = result.term ?? term;
      const cat = result.category ?? 'general';
      const catColor = {
        kubernetes: chalk.blue, docker: chalk.hex('#0db7ed'), network: chalk.hex('#00b4d8'),
        security: chalk.red, database: chalk.hex('#f4a261'), cloud: chalk.hex('#FF9900'),
        ci: chalk.yellow, git: chalk.hex('#f05032'), general: chalk.white,
      }[cat] ?? chalk.white;

      console.log('\n' + hr());
      console.log(`\n  ${chalk.bold.white(t)}  ${catColor(`[${cat}]`)}\n`);
      console.log(hr());

      if (result.summary) {
        console.log(chalk.bold('\n  What it is\n'));
        console.log(`  ${chalk.white(result.summary)}\n`);
      }

      if (result.rootCause) {
        console.log(chalk.bold('  Why it happens\n'));
        result.rootCause.split('\n').filter(Boolean).forEach((l) =>
          console.log(`  ${chalk.hex('#94a3b8')(l.trim())}`)
        );
        console.log('');
      }

      if (result.fixSteps) {
        console.log(chalk.bold('  How to fix it\n'));
        result.fixSteps.split('\n').filter(Boolean).forEach((l) =>
          console.log(`  ${chalk.hex('#94a3b8')(l.trim())}`)
        );
        console.log('');
      }

      if (result.commands) {
        console.log(chalk.bold('  Useful commands\n'));
        const cmds = result.commands.trim().split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
        const boxW = Math.min(Math.max(...cmds.map((c) => c.length), 40) + 4, 100);
        console.log('  ┌' + '─'.repeat(boxW) + '┐');
        cmds.forEach((c) => console.log(`  │ ${chalk.cyan(c.padEnd(boxW - 2))} │`));
        console.log('  └' + '─'.repeat(boxW) + '┘');
        console.log('');
      }

      console.log(hr() + '\n');
    });
}
