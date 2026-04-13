/**
 * nxs ci — CI/CD pipeline failure analyzer
 * Supports: GitHub Actions, GitLab CI, Jenkins, CircleCI
 */
import chalk from 'chalk';
import { printBanner } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';
import { run, hasBin } from '../core/exec.js';

const SYSTEM_PROMPT = `You are a senior CI/CD engineer. Analyze the provided pipeline failure log from GitHub Actions, GitLab CI, Jenkins, CircleCI, or similar systems.

Return a JSON object with exactly this structure:

{
  "tool": "<github-actions|gitlab-ci|jenkins|circleci|unknown>",
  "severity": "<critical|warning|info>",
  "pipeline": "<workflow/pipeline name if detectable>",
  "step": "<the exact job, step, or stage that failed>",
  "summary": "<1-2 sentence summary of what failed and why>",
  "rootCause": "<detailed breakdown: failed command, exit code, error message, root cause>",
  "fixSteps": "<numbered list of what to change to fix this — be specific>",
  "commands": "<exact commands to reproduce locally or fix the issue>"
}

Severity rules:
- critical: build broken, deployment blocked, all tests failing
- warning: partial failure, flaky test, non-blocking issue
- info: lint warning, deprecation, cache miss

Detection patterns:
- GitHub Actions: "##[error]", "::error::", "Process completed with exit code", "Run " prefix on steps
- GitLab CI: "Job failed", "ERROR:", "Running with gitlab-runner", "$ " commands
- Jenkins: "BUILD FAILED", "BUILD UNSTABLE", "hudson.", "Started by"
- CircleCI: "====>>", "circleci-agent", "exited with code", "Spin up environment"

Always identify: which step/job failed, what command, what error code, what the fix is.

Return ONLY valid JSON. No markdown fences.`;

const MOCK = {
  'github-actions': {
    tool: 'github-actions', severity: 'critical',
    pipeline: 'CI / build-and-test',
    step: 'Run npm test',
    summary: 'Tests failed in the "build-and-test" workflow — 3 unit tests failing in auth module.',
    rootCause: '1. AuthService.login() test fails: expected 200 but got 401\n2. Missing TEST_JWT_SECRET env var in workflow secrets\n3. Tests pass locally but fail in CI because the secret is not configured\n4. Exit code 1 from jest causes the step to fail',
    fixSteps: '1. Add TEST_JWT_SECRET to GitHub repo secrets (Settings → Secrets → Actions)\n2. Reference it in workflow YAML: env:\n     TEST_JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}\n3. Verify locally: export TEST_JWT_SECRET=test-value && npm test',
    commands: 'gh secret set TEST_JWT_SECRET --body "your-test-secret"\nnpm test -- --verbose 2>&1 | head -50\ngh run list --workflow=ci.yml --limit 5',
  },
  'gitlab-ci': {
    tool: 'gitlab-ci', severity: 'critical',
    pipeline: 'pipeline #1234',
    step: 'build:docker',
    summary: 'Docker build failed in the build:docker stage — base image pull returned 403 Forbidden.',
    rootCause: '1. Base image pull failed: "denied: access forbidden"\n2. Registry credentials not configured in CI/CD variables\n3. DOCKER_AUTH_CONFIG or docker login not set up for the runner',
    fixSteps: '1. Add registry credentials to CI/CD variables (Settings → CI/CD → Variables)\n2. Add DOCKER_AUTH_CONFIG with your registry auth JSON\n3. Or add before_script: docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY',
    commands: 'docker login registry.example.com -u <user> -p <token>\n# .gitlab-ci.yml before_script:\n# - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY',
  },
  jenkins: {
    tool: 'jenkins', severity: 'critical',
    pipeline: 'Jenkinsfile',
    step: 'sh "mvn clean package"',
    summary: 'Maven build failed — compilation error in src/main/java/com/app/Service.java.',
    rootCause: '1. Compilation error: cannot find symbol "UserRepository"\n2. Missing import or dependency declaration in pom.xml\n3. Exit code 1 returned to Jenkins from maven-compiler-plugin',
    fixSteps: '1. Check the import statement for UserRepository in Service.java\n2. Verify the dependency exists in pom.xml\n3. Run locally: mvn clean package -e to see full stack trace',
    commands: 'mvn clean package -e 2>&1 | grep -A5 "ERROR"\nmvn dependency:tree | grep UserRepository\ngit log --oneline -5',
  },
  circleci: {
    tool: 'circleci', severity: 'critical',
    pipeline: '.circleci/config.yml',
    step: 'run: pytest',
    summary: 'Python tests failed with import error — missing dependency in requirements.txt.',
    rootCause: '1. ModuleNotFoundError: No module named "requests_toolbelt"\n2. Package not listed in requirements.txt\n3. Works locally because it was installed manually, not tracked',
    fixSteps: '1. pip freeze > requirements.txt locally to capture all deps\n2. Or: pip install requests_toolbelt && pip freeze | grep requests_toolbelt >> requirements.txt\n3. Commit the updated requirements.txt',
    commands: 'pip install requests_toolbelt\npip freeze | grep requests_toolbelt\n# Add to requirements.txt, then:\ngit add requirements.txt && git commit -m "fix: add missing dep"',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();

  // Detect platform
  let tool = 'github-actions';
  if (lower.includes('gitlab-runner') || lower.includes('running with gitlab')) tool = 'gitlab-ci';
  else if (lower.includes('build failed') || lower.includes('hudson.')) tool = 'jenkins';
  else if (lower.includes('circleci-agent') || lower.includes('====>>')) tool = 'circleci';

  // ── Extract real details from the log text ──────────────────────────────────

  // Failed job/step
  const jobMatch = logText.match(/X\s+(.+?)\s+in\s+\d+s/) ||
                   logText.match(/FAILED:\s*(.+)/) ||
                   logText.match(/error in step[:\s]+(.+)/i);
  const failedJob = jobMatch?.[1]?.trim() ?? 'unknown step';

  // Annotation / error lines
  const annotations = [];
  for (const line of logText.split('\n')) {
    if (/^X /.test(line) && !/^X (main|.*CI)/.test(line) && !/^X .* in \d+s/.test(line)) {
      annotations.push(line.replace(/^X\s+/, '').trim());
    }
    if (/##\[error\]|::error::|Error:|ERROR:/.test(line)) {
      annotations.push(line.replace(/.*(?:##\[error\]|::error::)\s*/, '').trim());
    }
  }
  const errorLines = [...new Set(annotations)].slice(0, 5);

  // Workflow / branch / run URL from our injected header
  const workflowMatch = logText.match(/Workflow:\s*(.+)/);
  const branchMatch   = logText.match(/Branch:\s*(.+)/);
  const urlMatch      = logText.match(/Run URL:\s*(https?:\/\/\S+)/);
  const pipeline      = workflowMatch?.[1]?.trim() ?? 'unknown workflow';
  const branch        = branchMatch?.[1]?.trim() ?? 'unknown branch';
  const runUrl        = urlMatch?.[1]?.trim() ?? '';

  // Build a relevant response from what we extracted
  const errorSummary = errorLines.length > 0
    ? errorLines.join('\n')
    : 'Check the run logs for details.';

  const commands = [
    runUrl ? `# Open run:\n# ${runUrl}` : '',
    `gh run view --log-failed`,
    `npm run lint`,
  ].filter(Boolean).join('\n');

  return {
    tool,
    severity: 'critical',
    pipeline,
    step: failedJob,
    summary: `Pipeline "${pipeline}" failed on branch "${branch}" at step: ${failedJob}. No AI key configured — showing extracted log details.`,
    rootCause: errorSummary || 'Could not extract error details. Check the run URL.',
    fixSteps: `1. Open the failed run: ${runUrl || 'see GitHub Actions'}\n2. Check the "${failedJob}" step logs\n3. Fix the issue and push again\n4. Add GROQ_API_KEY or ANTHROPIC_API_KEY secret for AI-powered diagnosis`,
    commands,
  };
}

export function registerCi(program) {
  const ci = program
    .command('ci')
    .description('Analyze CI/CD pipeline failure logs (GitHub Actions, GitLab CI, Jenkins, CircleCI)');

  ci
    .command('analyze [file]')
    .description('Analyze a pipeline failure log')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste log interactively')
    .option('--run <id>', 'Fetch a GitHub Actions run by ID (requires gh CLI)')
    .option('--latest', 'Auto-fetch the most recent failed GitHub Actions run (requires gh CLI)')
    .option('--chat', 'Enable follow-up chat after analysis')
    .option('--redact', 'Scrub secrets before sending to AI')
    .option('-o, --output <file>', 'Save analysis to markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .option('--notify <target>', 'Notify after analysis: slack')
    .option('--fast', 'Rules engine only — no AI call (instant, offline)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ nxs ci analyze build.log
  $ gh run view 12345 --log-failed | nxs ci analyze --stdin
  $ nxs ci analyze --run 12345          # auto-fetch via gh CLI
  $ nxs ci analyze --latest             # auto-fetch most recent failed run
  $ nxs ci analyze --stdin --fail-on critical
  $ cat .github/workflows/*.log | nxs ci analyze --stdin`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('CI/CD failure analyzer');

      // --latest: find most recent failed run and fetch its logs
      if (opts.latest) {
        const hasGh = await hasBin('gh');
        if (!hasGh) {
          console.error(chalk.red('  gh CLI not found. Install: https://cli.github.com/'));
          process.exit(1);
        }
        if (!opts.json) console.log(chalk.dim('  Finding most recent failed run…\n'));

        const { stdout: listOut, ok: listOk } = await run(
          'gh run list --json databaseId,status,conclusion,name,headBranch,createdAt --limit 20 2>/dev/null',
          { timeout: 30000 }
        );
        if (!listOk || !listOut.trim()) {
          console.error(chalk.red('  Could not list runs. Check: gh auth status'));
          process.exit(1);
        }

        let runs = [];
        try { runs = JSON.parse(listOut); } catch {
          console.error(chalk.red('  Failed to parse run list. Check: gh version / gh auth status'));
          process.exit(1);
        }

        const failed = runs.find(r =>
          r.conclusion === 'failure' || r.conclusion === 'timed_out' ||
          (r.status === 'completed' && r.conclusion !== 'success')
        );

        if (!failed) {
          console.log(chalk.green('  No recent failed runs found.\n'));
          process.exit(0);
        }

        if (!opts.json) {
          console.log(chalk.dim(`  Most recent failure: ${chalk.white(failed.name)} — run ${chalk.white(failed.databaseId)}`));
          console.log(chalk.dim(`  Branch: ${failed.headBranch}  |  ${new Date(failed.createdAt).toLocaleString()}\n`));
        }

        opts.run = String(failed.databaseId);
      }

      // --run <id>: fetch GitHub Actions run log via gh CLI
      if (opts.run) {
        const hasGh = await hasBin('gh');
        if (!hasGh) {
          console.error(chalk.red('  gh CLI not found. Install: https://cli.github.com/'));
          console.error(chalk.dim('  Or pipe manually: gh run view <id> --log-failed | nxs ci analyze --stdin'));
          process.exit(1);
        }
        if (!opts.json) console.log(chalk.dim(`  Fetching GitHub Actions run: ${chalk.white(opts.run)}\n`));

        // Try failed-only log first; fall back to full log for passing runs
        let logOutput = '';
        const { stdout: failedLog, ok } = await run(`gh run view "${opts.run}" --log-failed 2>/dev/null`, { timeout: 30000 });
        if (ok && failedLog.trim()) {
          logOutput = failedLog;
        } else {
          // Run may have passed — fetch full log (first 500 lines)
          const { stdout: fullLog, ok: fullOk } = await run(`gh run view "${opts.run}" --log 2>/dev/null`, { timeout: 30000 });
          if (!fullOk || !fullLog.trim()) {
            console.error(chalk.red(`  Could not fetch run ${opts.run}. Check the run ID and gh auth.`));
            console.error(chalk.dim('  Run: gh auth status'));
            process.exit(1);
          }
          logOutput = fullLog.split('\n').slice(0, 500).join('\n');
          if (!opts.json) console.log(chalk.dim('  (Run passed — showing full log for context)\n'));
        }
        await runAnalyze('ci', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: logOutput });
        return;
      }

      await runAnalyze('ci', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  ci
    .command('history')
    .description('Show past CI/CD analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear ci history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('CI/CD failure analyzer');
      await runHistory('ci', opts);
    });
}
