/**
 * nxs sec — Security scan analyzer
 * Supports: Trivy, Grype, Snyk, OWASP Dependency Check
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';
import { run, hasBin } from '../core/exec.js';

const SYSTEM_PROMPT = `You are a senior application security engineer (AppSec). Analyze the provided security scan output from tools like Trivy, Grype, Snyk, or OWASP Dependency Check.

Return a JSON object with exactly this structure:

{
  "tool": "<trivy|grype|snyk|owasp|unknown>",
  "severity": "<one of: critical, warning, info>",
  "scanner": "<detected scanner name>",
  "target": "<image name, repo, or file scanned if detectable>",
  "summary": "<1-2 sentence summary of the security posture>",
  "rootCause": "<breakdown: total vulns, how many critical/high/medium/low, which packages are the biggest risk>",
  "fixSteps": "<prioritized fix list — fix critical first, then high. Include specific package versions to upgrade to>",
  "commands": "<exact commands to fix — e.g. npm update, apt-get upgrade, FROM base image update, etc.>"
}

Severity rules:
- critical: any CRITICAL CVEs found
- warning: HIGH CVEs found but no CRITICAL
- info: only MEDIUM/LOW or no vulns

Key patterns to detect:
- Trivy: "Total: X (CRITICAL: Y, HIGH: Z)" or table format with CVE IDs
- Grype: "NAME  INSTALLED  FIXED-IN  TYPE  VULNERABILITY  SEVERITY"
- Snyk: "✗ High severity vulnerability found" or JSON with vulnerabilities array
- OWASP: "CVE-XXXX-XXXX" with CVSS scores

Always prioritize:
1. CRITICAL CVEs with a known fix — fix immediately
2. HIGH CVEs with a known fix — fix this sprint
3. CRITICAL/HIGH with no fix — mitigate or accept risk
4. MEDIUM/LOW — schedule for next cycle

Return ONLY valid JSON. No markdown fences.`;

const MOCK_RESPONSES = {
  trivy: {
    tool: 'trivy',
    severity: 'critical',
    scanner: 'Trivy',
    target: 'myapp:latest',
    summary: 'Critical vulnerabilities found in base image and npm dependencies. Immediate action required on 3 CRITICAL CVEs with available fixes.',
    rootCause: '1. Base image (node:18-bullseye) contains 3 CRITICAL CVEs in libssl and zlib.\n2. npm package "axios@0.21.1" has a CRITICAL SSRF vulnerability (CVE-2023-45857).\n3. 8 HIGH severity CVEs in system packages — most have fixes available.\n4. Total: 47 vulnerabilities (CRITICAL: 3, HIGH: 8, MEDIUM: 24, LOW: 12).',
    fixSteps: '- CRITICAL: Update base image to node:18-alpine or node:20-bookworm-slim\n- CRITICAL: Upgrade axios to 1.6.0+ (fixes CVE-2023-45857)\n- HIGH: Run apt-get upgrade inside container for system package fixes\n- Rebuild and re-scan after fixes to verify\n- Consider pinning base image digest for reproducibility',
    commands: 'npm update axios\nnpm audit fix\ndocker pull node:20-alpine\ntrivy image --exit-code 1 --severity CRITICAL myapp:latest\nnpm audit --audit-level=critical',
  },
  grype: {
    tool: 'grype',
    severity: 'critical',
    scanner: 'Grype',
    target: 'myapp:latest',
    summary: 'Grype detected 2 CRITICAL vulnerabilities in Python dependencies with available fixes.',
    rootCause: '1. requests==2.28.0 — CVE-2023-32681 (CRITICAL) — improper redirect handling allows credential leakage.\n2. cryptography==38.0.0 — CVE-2023-49083 (CRITICAL) — NULL pointer dereference.\n3. Total: 28 vulnerabilities across Python packages.',
    fixSteps: '- Upgrade requests to 2.31.0+\n- Upgrade cryptography to 41.0.6+\n- Run pip-audit regularly in CI\n- Add grype to your CI pipeline with --fail-on critical',
    commands: 'pip install --upgrade requests==2.31.0\npip install --upgrade cryptography==41.0.6\npip install pip-audit\npip-audit\ngrype myapp:latest --fail-on critical',
  },
  snyk: {
    tool: 'snyk',
    severity: 'warning',
    scanner: 'Snyk',
    target: 'package.json',
    summary: 'Snyk found 4 HIGH severity vulnerabilities in npm dependencies — no CRITICAL issues.',
    rootCause: '1. lodash@4.17.20 — Prototype Pollution (HIGH) — CVE-2021-23337\n2. minimist@1.2.5 — Prototype Pollution (HIGH) — CVE-2021-44906\n3. node-fetch@2.6.1 — Information exposure (HIGH) — CVE-2022-0235\n4. Total: 4 HIGH, 11 MEDIUM vulnerabilities.',
    fixSteps: '- Run npm audit fix to auto-fix most issues\n- Manually upgrade lodash to 4.17.21+\n- Replace node-fetch@2 with native fetch (Node 18+) or upgrade to node-fetch@3\n- Add snyk test to CI pipeline',
    commands: 'npm audit fix\nnpm update lodash minimist\nsnyk test --severity-threshold=high\nsnyk monitor',
  },
  clean: {
    tool: 'trivy',
    severity: 'info',
    scanner: 'Trivy',
    target: 'myapp:latest',
    summary: 'No critical or high vulnerabilities found. Image has a clean security posture.',
    rootCause: '1. 0 CRITICAL CVEs\n2. 0 HIGH CVEs\n3. 3 MEDIUM CVEs — informational, no immediate action needed\n4. Base image is up to date.',
    fixSteps: '- Schedule MEDIUM CVEs for next maintenance cycle\n- Continue regular scanning in CI\n- Consider pinning base image digest for reproducibility',
    commands: 'trivy image --exit-code 0 myapp:latest\ndocker pull node:20-alpine  # keep base image updated',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('trivy') || lower.includes('total:') && lower.includes('critical:')) return MOCK_RESPONSES.trivy;
  if (lower.includes('grype') || lower.includes('fixed-in') && lower.includes('vulnerability')) return MOCK_RESPONSES.grype;
  if (lower.includes('snyk') || lower.includes('severity vulnerability found')) return MOCK_RESPONSES.snyk;
  if ((lower.includes('0 critical') || lower.includes('critical: 0')) && lower.includes('high: 0')) return MOCK_RESPONSES.clean;
  return MOCK_RESPONSES.trivy;
}

export function registerSec(program) {
  const sec = program
    .command('sec')
    .description('Analyze security scan output (Trivy, Grype, Snyk, OWASP)');

  sec
    .command('scan [file]')
    .description('Analyze a security scan report')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste scan output interactively')
    .option('-p, --pod <name>', 'Scan a running pod — auto-detects image and runs trivy')
    .option('-n, --namespace <ns>', 'Namespace for --pod (default: default)')
    .option('--image <image>', 'Scan a Docker image directly with trivy (if installed)')
    .option('-j, --json', 'Output as JSON')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .addHelpText('after', `
Examples:
  $ trivy image myapp:latest | nxs sec scan --stdin
  $ grype myapp:latest | nxs sec scan --stdin
  $ snyk test --json | nxs sec scan --stdin
  $ nxs sec scan report.txt
  $ nxs sec scan --pod my-pod -n production
  $ nxs sec scan --image nginx:latest`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('Security scan analyzer');

      // --image: run trivy locally and pipe output
      if (opts.image) {
        const hasTrivy = await hasBin('trivy');
        if (!hasTrivy) {
          console.error(chalk.red('  trivy not found. Install: https://trivy.dev/latest/getting-started/installation/'));
          process.exit(1);
        }
        if (!opts.json) console.log(chalk.dim(`  Running trivy on image: ${chalk.white(opts.image)}\n`));
        const { stdout, stderr } = await run(`trivy image --no-progress ${opts.image} 2>/dev/null`);
        const output = stdout || stderr;
        if (!output.trim()) {
          console.error(chalk.red('  trivy returned no output.'));
          process.exit(1);
        }
        await runAnalyze('sec', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: output });
        return;
      }

      // --pod: get image from pod, then scan with trivy
      if (opts.pod) {
        const ns = opts.namespace ? `-n ${opts.namespace}` : '';
        if (!opts.json) console.log(chalk.dim(`  Fetching image from pod: ${chalk.white(opts.pod)}\n`));

        const { stdout: podJson } = await run(`kubectl get pod ${opts.pod} ${ns} -o json 2>/dev/null`);
        if (!podJson) {
          console.error(chalk.red(`  Pod '${opts.pod}' not found or kubectl not configured.`));
          process.exit(1);
        }

        let image;
        try {
          const pod = JSON.parse(podJson);
          image = pod.spec?.containers?.[0]?.image;
        } catch {
          console.error(chalk.red('  Could not parse pod spec.'));
          process.exit(1);
        }

        if (!image) {
          console.error(chalk.red('  Could not detect image from pod spec.'));
          process.exit(1);
        }

        console.log(chalk.dim(`  Image: ${chalk.white(image)}\n`));

        const hasTrivy = await hasBin('trivy');
        if (!hasTrivy) {
          console.error(chalk.red('  trivy not found. Install: https://trivy.dev/latest/getting-started/installation/'));
          console.error(chalk.dim(`  Or run manually: trivy image ${image} | nxs sec scan --stdin`));
          process.exit(1);
        }

        const { stdout, stderr } = await run(`trivy image --no-progress ${image} 2>/dev/null`);
        const output = stdout || stderr;
        await runAnalyze('sec', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: output });
        return;
      }

      await runAnalyze('sec', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  sec
    .command('history')
    .description('Show past security scan analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear sec history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('Security scan analyzer');
      await runHistory('sec', opts);
    });

  sec
    .command('severities')
    .description('CVE severity reference card')
    .action(() => {
      printBanner('Security scan analyzer');
      console.log(chalk.bold('\n  CVE Severity levels — what to do\n'));
      console.log(hr());

      const levels = [
        {
          level: 'CRITICAL',
          cvss: '9.0–10.0',
          color: chalk.red,
          action: 'Fix immediately — block deployment if possible',
          example: 'Remote code execution, auth bypass',
        },
        {
          level: 'HIGH',
          cvss: '7.0–8.9',
          color: chalk.hex('#ff6b35'),
          action: 'Fix this sprint — do not ship knowingly',
          example: 'Privilege escalation, sensitive data exposure',
        },
        {
          level: 'MEDIUM',
          cvss: '4.0–6.9',
          color: chalk.yellow,
          action: 'Schedule for next cycle — track and plan',
          example: 'CSRF, open redirect, info disclosure',
        },
        {
          level: 'LOW',
          cvss: '0.1–3.9',
          color: chalk.dim,
          action: 'Fix when convenient — low risk',
          example: 'Minor info leak, hardening issues',
        },
        {
          level: 'UNKNOWN',
          cvss: 'N/A',
          color: chalk.dim,
          action: 'Investigate — CVSS score not yet assigned',
          example: 'Recently disclosed CVE',
        },
      ];

      levels.forEach(({ level, cvss, color, action, example }) => {
        console.log(`\n  ${color(`● ${level}`)}  ${chalk.dim(`CVSS ${cvss}`)}`);
        console.log(`    ${chalk.white(action)}`);
        console.log(chalk.dim(`    e.g. ${example}`));
      });

      console.log('\n' + hr());
      console.log(chalk.dim('\n  Pipe any scanner output to: trivy image myapp | nxs sec scan --stdin\n'));
      console.log(chalk.dim('  Supported: Trivy · Grype · Snyk · OWASP Dependency Check\n'));
    });
}
