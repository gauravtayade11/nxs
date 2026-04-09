/**
 * nxs k8s — Kubernetes deep-dive tool
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';
import { run } from '../core/exec.js';

const SYSTEM_PROMPT = `You are a Kubernetes expert (CKA/CKAD level). Analyze the provided Kubernetes log, event, or error output.
Return a JSON object with exactly this structure:

{
  "tool": "kubernetes",
  "severity": "<one of: critical, warning, info>",
  "resource": "<the K8s resource type involved: Pod, Deployment, Service, PVC, Node, etc.>",
  "namespace": "<namespace if detectable, else 'unknown'>",
  "summary": "<1-2 sentence summary>",
  "rootCause": "<detailed root cause, numbered list>",
  "fixSteps": "<step-by-step fix, use - for each bullet>",
  "commands": "<kubectl commands to diagnose/fix, one per line>"
}

Common patterns to detect:
- ImagePullBackOff / ErrImagePull: registry auth or wrong image tag
- CrashLoopBackOff: app crashing on startup — check logs
- OOMKilled: memory limit hit — increase resources or fix memory leak
- Pending: scheduling issue — check node resources, taints, tolerations
- Error: NotFound / Forbidden: RBAC or missing resource
- PVC not binding: StorageClass issue or no available PV

Return ONLY valid JSON. No markdown fences.`;

const MOCK_RESPONSES = {
  imagepull: {
    tool: 'kubernetes', severity: 'critical', resource: 'Pod', namespace: 'default',
    summary: 'Pod failing to start due to ImagePullBackOff — cannot pull container image.',
    rootCause: '1. Image name or tag is incorrect or does not exist.\n2. Registry requires authentication (imagePullSecrets missing).\n3. Network issue preventing registry access.',
    fixSteps: '- Verify the image name and tag in the deployment manifest.\n- Check the image exists in the registry.\n- If private registry, create and attach imagePullSecrets.',
    commands: 'kubectl describe pod <pod-name>\nkubectl get events --sort-by=\'.metadata.creationTimestamp\'\nkubectl create secret docker-registry regcred --docker-server=<server> --docker-username=<user> --docker-password=<pass>',
  },
  crashloop: {
    tool: 'kubernetes', severity: 'critical', resource: 'Pod', namespace: 'default',
    summary: 'Pod is in CrashLoopBackOff — application is crashing repeatedly on startup.',
    rootCause: '1. Application exits with non-zero code on startup.\n2. Missing environment variables or ConfigMap/Secret.\n3. Liveness probe too aggressive.\n4. Port conflict inside the container.',
    fixSteps: '- Check container logs for the actual error.\n- Verify all required env vars and secrets are mounted.\n- Increase initialDelaySeconds on liveness probe.\n- Test the image locally with docker run.',
    commands: 'kubectl logs <pod-name> --previous\nkubectl describe pod <pod-name>\nkubectl get pod <pod-name> -o yaml | grep -A10 livenessProbe',
  },
  oom: {
    tool: 'kubernetes', severity: 'critical', resource: 'Pod', namespace: 'default',
    summary: 'Container was OOMKilled — exceeded its memory limit.',
    rootCause: '1. Memory limit set too low for the workload.\n2. Memory leak in the application.\n3. Sudden traffic spike causing memory spike.',
    fixSteps: '- Increase memory limits in the pod spec.\n- Profile the app for memory leaks.\n- Set up HPA to scale under load.\n- Add memory alerts in monitoring.',
    commands: 'kubectl top pod <pod-name>\nkubectl describe pod <pod-name> | grep -A5 OOM\nkubectl edit deployment <deployment-name>',
  },
  pending: {
    tool: 'kubernetes', severity: 'warning', resource: 'Pod', namespace: 'default',
    summary: 'Pod stuck in Pending state — scheduler cannot place it on any node.',
    rootCause: '1. Insufficient CPU or memory on all nodes.\n2. Node selector or affinity rules not satisfied.\n3. Taint on all nodes without matching toleration.\n4. PVC not bound.',
    fixSteps: '- Check node resources with kubectl top nodes.\n- Review nodeSelector and affinity in pod spec.\n- Check for taints on nodes.\n- Verify PVC is bound if used.',
    commands: 'kubectl describe pod <pod-name>\nkubectl top nodes\nkubectl get nodes -o wide\nkubectl describe pvc <pvc-name>',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('imagepullbackoff') || lower.includes('errimagepull')) return MOCK_RESPONSES.imagepull;
  if (lower.includes('crashloopbackoff')) return MOCK_RESPONSES.crashloop;
  if (lower.includes('oomkilled') || lower.includes('oom')) return MOCK_RESPONSES.oom;
  if (lower.includes('pending')) return MOCK_RESPONSES.pending;
  return {
    tool: 'kubernetes', severity: 'info', resource: 'unknown', namespace: 'unknown',
    summary: 'Kubernetes error detected but type could not be determined.',
    rootCause: 'Could not match a known Kubernetes error pattern.',
    fixSteps: '- Run kubectl describe on the resource.\n- Check kubectl get events.',
    commands: 'kubectl get events --all-namespaces --sort-by=\'.metadata.creationTimestamp\'\nkubectl describe <resource> <name>',
  };
}

export function registerK8s(program) {
  const k8s = program
    .command('k8s')
    .description('Deep-dive Kubernetes debugging (pods, nodes, events)');

  k8s
    .command('debug [file]')
    .description('Debug a Kubernetes error or pod log')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste log interactively')
    .option('-p, --pod <name>', 'Pod name — auto-fetches logs + describe (no piping needed)')
    .option('-d, --deployment <name>', 'Deployment name — fetches logs from all pods in the deployment')
    .option('-n, --namespace <ns>', 'Namespace (default: default)')
    .option('-j, --json', 'Output as JSON')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets/tokens from log before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .option('--notify <target>', 'Notify after analysis: slack')
    .addHelpText('after', `
Examples:
  $ nxs k8s debug pod-error.log
  $ nxs k8s debug --pod crash-demo -n nextsight-demo
  $ nxs k8s debug --deployment my-app -n production
  $ kubectl describe pod my-pod | nxs k8s debug --stdin
  $ kubectl logs my-pod --previous | nxs k8s debug -s`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('Kubernetes deep-dive debugger');

      // --deployment: fetch logs from all pods in the deployment
      if (opts.deployment) {
        const ns = opts.namespace ? `-n ${opts.namespace}` : '';
        if (!opts.json) console.log(chalk.dim(`  Fetching pods for deployment: ${chalk.white(opts.deployment)}\n`));

        const deployR = await run(`kubectl get deploy ${opts.deployment} ${ns} -o json 2>/dev/null`);
        if (!deployR.stdout?.trim()) {
          console.error(chalk.red(`  Deployment '${opts.deployment}' not found or kubectl not configured.`));
          process.exit(1);
        }

        let pods = [];
        try {
          const deploy = JSON.parse(deployR.stdout);
          const matchLabels = deploy.spec?.selector?.matchLabels ?? {};
          const labelSelector = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',');
          const podsR = await run(`kubectl get pods ${ns} -l '${labelSelector}' -o jsonpath='{.items[*].metadata.name}' 2>/dev/null`);
          pods = podsR.stdout.trim().split(/\s+/).filter(Boolean);
        } catch {
          console.error(chalk.red('  Failed to parse deployment info.'));
          process.exit(1);
        }

        if (pods.length === 0) {
          console.error(chalk.red(`  No pods found for deployment '${opts.deployment}'.`));
          process.exit(1);
        }

        if (!opts.json) console.log(chalk.dim(`  Found ${pods.length} pod(s): ${pods.join(', ')}\n`));

        const podSections = await Promise.all(pods.map(async (pod) => {
          const [logsR, descR] = await Promise.all([
            run(`kubectl logs ${pod} ${ns} --tail=100 --previous 2>/dev/null || kubectl logs ${pod} ${ns} --tail=100 2>/dev/null`),
            run(`kubectl describe pod ${pod} ${ns} 2>/dev/null`),
          ]);
          return [
            `=== POD: ${pod} — LOGS ===`,
            logsR.stdout?.trim() || '(no logs)',
            `=== POD: ${pod} — DESCRIBE ===`,
            descR.stdout?.trim() || '(no describe output)',
          ].join('\n');
        }));

        const combined = podSections.join('\n\n');
        opts.stdin = true;
        process.stdin.destroy();
        await runAnalyze('k8s', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: combined });
        return;
      }

      // --pod: auto-fetch logs + describe, no piping needed
      if (opts.pod) {
        const ns = opts.namespace ? `-n ${opts.namespace}` : '';
        if (!opts.json) console.log(chalk.dim(`  Fetching logs + describe for pod: ${chalk.white(opts.pod)}\n`));
        const [logsR, descR] = await Promise.all([
          run(`kubectl logs ${opts.pod} ${ns} --previous 2>/dev/null || kubectl logs ${opts.pod} ${ns} 2>/dev/null`),
          run(`kubectl describe pod ${opts.pod} ${ns} 2>/dev/null`),
        ]);
        const combined = [
          logsR.stdout ? `=== LOGS ===\n${logsR.stdout}` : '',
          descR.stdout ? `=== DESCRIBE ===\n${descR.stdout}` : '',
        ].filter(Boolean).join('\n\n');

        if (!combined.trim()) {
          console.error(chalk.red(`  Pod '${opts.pod}' not found or kubectl not configured.`));
          process.exit(1);
        }
        opts.stdin = true;
        process.stdin.destroy();
        await runAnalyze('k8s', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: combined });
        return;
      }

      await runAnalyze('k8s', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  k8s
    .command('history')
    .description('Show past Kubernetes analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear k8s history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('Kubernetes deep-dive debugger');
      await runHistory('k8s', opts);
    });

  k8s
    .command('errors')
    .description('Quick reference for common Kubernetes errors')
    .action(() => {
      printBanner('Kubernetes deep-dive debugger');
      console.log(chalk.bold('\n  Common Kubernetes errors:\n'));
      console.log(hr());

      const errors = [
        { code: 'ImagePullBackOff',   sev: 'critical', tip: 'Wrong image name/tag or missing registry credentials' },
        { code: 'CrashLoopBackOff',   sev: 'critical', tip: 'App crashing on startup — check logs with --previous' },
        { code: 'OOMKilled',          sev: 'critical', tip: 'Memory limit exceeded — increase limits or fix leak' },
        { code: 'Pending',            sev: 'warning',  tip: 'Scheduler cannot place pod — check node resources/taints' },
        { code: 'CreateContainerErr', sev: 'critical', tip: 'Missing ConfigMap, Secret, or volume mount' },
        { code: 'Evicted',            sev: 'warning',  tip: 'Node under resource pressure — check disk/memory' },
        { code: 'Terminating (stuck)',sev: 'warning',  tip: 'Finalizer not releasing — patch to remove finalizer' },
        { code: 'ErrImageNeverPull',  sev: 'warning',  tip: 'imagePullPolicy: Never but image not present locally' },
      ];

      const sevColor = { critical: chalk.red, warning: chalk.yellow, info: chalk.dim };

      errors.forEach(({ code, sev, tip }) => {
        console.log(`\n  ${sevColor[sev](`● ${sev.toUpperCase()}`)}  ${chalk.bold.white(code)}`);
        console.log(chalk.dim(`    ${tip}`));
      });

      console.log('\n' + hr());
      console.log(chalk.dim('\n  Pipe any of these to: kubectl describe pod <name> | nxs k8s debug --stdin\n'));
    });
}
