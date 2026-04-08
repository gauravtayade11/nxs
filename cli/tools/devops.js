/**
 * nxs devops — CI/CD, Docker, Terraform, general pipeline errors
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';

const SYSTEM_PROMPT = `You are an expert DevOps engineer specializing in CI/CD pipelines, Docker, and Terraform.
Analyze the provided log and return a JSON object with exactly this structure:

{
  "tool": "<one of: docker, terraform, ci, unknown>",
  "severity": "<one of: critical, warning, info>",
  "summary": "<1-2 sentence summary of the error>",
  "rootCause": "<detailed root cause, numbered list if multiple>",
  "fixSteps": "<step-by-step fix, use - for each bullet>",
  "commands": "<shell commands to fix/investigate, one per line>"
}

Tool detection:
- docker: docker build/run/compose, Dockerfile, container layers, registry errors
- terraform: .tf files, provider blocks, plan/apply/init errors
- ci: GitHub Actions, Jenkins, GitLab CI, CircleCI, npm/pip install in pipeline
- unknown: anything else

Return ONLY valid JSON. No markdown fences.`;

const MOCK = {
  docker: {
    tool: 'docker', severity: 'critical',
    summary: 'Docker build failing due to executor error in RUN step.',
    rootCause: '1. Base image missing required shell or tool.\n2. npm install failed due to permission or network issue.',
    fixSteps: '- Use --no-cache to rule out stale layers.\n- Verify base image has required tools.\n- Check network access from build environment.',
    commands: 'docker build --no-cache -t my-app .\ndocker run -it --entrypoint /bin/sh <base_image>',
  },
  terraform: {
    tool: 'terraform', severity: 'warning',
    summary: 'Terraform encountered an invalid resource type in your configuration.',
    rootCause: '1. Typo in resource type name.\n2. Provider version mismatch — attribute removed or renamed.',
    fixSteps: '- Check the Terraform registry for the correct resource name.\n- Run terraform validate to catch issues early.\n- Pin provider version in required_providers block.',
    commands: 'terraform fmt\nterraform validate\nterraform plan -refresh=false',
  },
  ci: {
    tool: 'ci', severity: 'critical',
    summary: 'CI pipeline failed during dependency installation.',
    rootCause: '1. Missing native build dependencies (node-gyp, Python, CMake).\n2. Custom postinstall script failing.',
    fixSteps: '- Switch from npm install to npm ci.\n- Add build-essential to runner environment.\n- Check postinstall scripts in package.json.',
    commands: 'npm ci\nnpm cache clean --force\nrm -rf node_modules && npm install',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('docker') || lower.includes('executor failed')) return MOCK.docker;
  if (lower.includes('terraform') || lower.includes('invalid resource')) return MOCK.terraform;
  if (lower.includes('npm') || lower.includes('jenkins') || lower.includes('github actions')) return MOCK.ci;
  return { tool: 'unknown', severity: 'info', summary: 'Could not determine error type.', rootCause: 'Unknown error.', fixSteps: '- Increase log verbosity.', commands: 'export DEBUG=*' };
}

export function registerDevops(program) {
  const devops = program
    .command('devops')
    .description('Debug CI/CD pipelines, Docker builds, Terraform errors');

  devops
    .command('analyze [file]')
    .description('Analyze a DevOps log (CI/CD, Docker, Terraform)')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste log interactively')
    .option('-j, --json', 'Output as JSON')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets/tokens from log before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .addHelpText('after', `
Examples:
  $ nxs devops analyze build.log
  $ docker build . 2>&1 | nxs devops analyze --stdin
  $ cat pipeline.log | nxs devops analyze -s
  $ nxs devops analyze --interactive`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('CI/CD · Docker · Terraform debugger');
      await runAnalyze('devops', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  devops
    .command('history')
    .description('Show past DevOps analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear DevOps history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('CI/CD · Docker · Terraform debugger');
      await runHistory('devops', opts);
    });

  devops
    .command('watch <file>')
    .description('Tail a live log file and auto-analyze when errors appear')
    .option('--no-chat', 'Skip follow-up chat after each analysis')
    .option('--redact', 'Scrub secrets before sending to AI')
    .option('-o, --output <file>', 'Append each analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 on first match of severity')
    .addHelpText('after', `
Examples:
  $ nxs devops watch /var/log/app.log
  $ nxs devops watch pipeline.log --no-chat
  $ nxs devops watch deploy.log --fail-on critical`)
    .action(async (file, opts) => {
      printBanner('CI/CD · Docker · Terraform debugger');

      if (!existsSync(file)) {
        console.error(chalk.red(`  File not found: ${file}`));
        process.exit(1);
      }

      let lastSize = statSync(file).size;
      console.log(chalk.cyan(`  Watching ${chalk.white(file)} for errors — Ctrl+C to stop\n`));
      console.log(chalk.dim('  Triggers on lines containing: error, fail, exception, fatal, panic\n'));

      const ERROR_RE = /error|fail|exception|fatal|panic|traceback|stderr/i;
      const DEBOUNCE_MS = 3000;
      let buffer = '';
      let debounceTimer = null;

      const flush = async (chunk) => {
        if (!opts.json) process.stdout.write(chalk.dim('  New errors detected — analyzing...\n'));
        await runAnalyze('devops', SYSTEM_PROMPT, mockAnalyze, null, {
          ...opts,
          _injected: chunk,
          chat: false,
        });
      };

      setInterval(async () => {
        const currentSize = statSync(file).size;
        if (currentSize <= lastSize) return;

        const newBytes = readFileSync(file).slice(lastSize);
        lastSize = currentSize;
        const newText = newBytes.toString('utf8');

        if (!ERROR_RE.test(newText)) return;

        buffer += newText;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const chunk = buffer;
          buffer = '';
          await flush(chunk);
        }, DEBOUNCE_MS);
      }, 1000);
    });

  devops
    .command('examples')
    .description('Show example error logs to test with')
    .action(() => {
      printBanner('CI/CD · Docker · Terraform debugger');
      console.log(chalk.bold('\n  Example logs to test with:\n'));

      const examples = [
        {
          label: 'Docker build failure',
          log: 'executor failed running [/bin/sh -c npm install]: exit code: 243',
        },
        {
          label: 'Terraform invalid resource',
          log: 'Error: Invalid resource type "aws_s3_buckets" — did you mean "aws_s3_bucket"?',
        },
        {
          label: 'GitHub Actions npm failure',
          log: 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed',
        },
      ];

      examples.forEach(({ label, log }) => {
        console.log(`  ${chalk.cyan('›')} ${chalk.bold(label)}`);
        console.log(chalk.dim(`    echo '${log}' | nxs devops analyze --stdin\n`));
      });
    });
}
