/**
 * nxs cloud — AWS, GCP, Azure error diagnosis
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { printBanner } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';

const SYSTEM_PROMPT = `You are an expert cloud engineer specializing in AWS, GCP, and Azure.
Analyze the provided error or log and return a JSON object with exactly this structure:

{
  "tool": "<one of: aws, gcp, azure, unknown>",
  "severity": "<one of: critical, warning, info>",
  "service": "<the specific cloud service involved, e.g. EC2, S3, Lambda, GKE, etc.>",
  "summary": "<1-2 sentence summary of the error>",
  "rootCause": "<detailed root cause, numbered list if multiple>",
  "fixSteps": "<step-by-step fix, use - for each bullet>",
  "commands": "<CLI commands to fix/investigate, one per line — use aws/gcloud/az CLI>"
}

Tool detection:
- aws: AWS, Amazon, EC2, S3, Lambda, IAM, RDS, ECS, EKS, CloudFormation, boto3, AccessDenied
- gcp: Google Cloud, GCP, gcloud, GKE, BigQuery, Cloud Run, Pub/Sub, GCS
- azure: Azure, Microsoft, az cli, AKS, Blob, CosmosDB, ARM template

Return ONLY valid JSON. No markdown fences.`;

const MOCK = {
  aws: {
    tool: 'aws', severity: 'critical', service: 'IAM',
    summary: 'AWS API call failed due to insufficient IAM permissions.',
    rootCause: '1. The IAM role or user lacks the required policy for this action.\n2. The resource-level policy is denying access.\n3. SCP (Service Control Policy) at the organization level is blocking the action.',
    fixSteps: '- Check the IAM policy attached to the role/user.\n- Use IAM Policy Simulator to test permissions.\n- Check CloudTrail for the exact denied action.\n- Add the missing permission to the policy.',
    commands: 'aws iam simulate-principal-policy --policy-source-arn <arn> --action-names <action>\naws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=<action>\naws iam get-role --role-name <role>',
  },
  gcp: {
    tool: 'gcp', severity: 'warning', service: 'IAM',
    summary: 'GCP API call denied due to missing IAM permissions.',
    rootCause: '1. Service account lacks required role.\n2. API not enabled for the project.\n3. Org-level policy constraining access.',
    fixSteps: '- Check the service account roles in IAM & Admin.\n- Enable the required API in the Console.\n- Review org policy constraints.',
    commands: 'gcloud projects get-iam-policy <project>\ngcloud services list --enabled\ngcloud iam service-accounts get-iam-policy <sa-email>',
  },
  azure: {
    tool: 'azure', severity: 'warning', service: 'RBAC',
    summary: 'Azure resource access denied due to missing RBAC role assignment.',
    rootCause: '1. Principal lacks required built-in or custom RBAC role.\n2. Role assignment scope is too narrow.\n3. Managed identity not properly configured.',
    fixSteps: '- Check role assignments for the resource.\n- Assign the appropriate built-in role.\n- Verify managed identity is enabled on the resource.',
    commands: 'az role assignment list --assignee <principal>\naz role definition list --query "[?contains(roleName, \'Contributor\')]"\naz resource show --ids <resource-id>',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('aws') || lower.includes('amazon') || lower.includes('accessdenied') || lower.includes('boto')) return MOCK.aws;
  if (lower.includes('gcp') || lower.includes('google') || lower.includes('gcloud')) return MOCK.gcp;
  if (lower.includes('azure') || lower.includes('microsoft') || lower.includes('az ')) return MOCK.azure;
  return { tool: 'unknown', severity: 'info', service: 'unknown', summary: 'Could not detect cloud provider.', rootCause: 'Unknown error.', fixSteps: '- Add more context to the log.', commands: 'echo "unknown"' };
}


export function registerCloud(program) {
  const cloud = program
    .command('cloud')
    .description('Diagnose AWS, GCP, and Azure errors');

  cloud
    .command('diagnose [file]')
    .description('Diagnose a cloud provider error (AWS, GCP, Azure)')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste error interactively')
    .option('-j, --json', 'Output as JSON')
    .option('--fast', 'Rules engine only — no AI call (instant, offline)')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets/tokens from log before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .addHelpText('after', `
Examples:
  $ nxs cloud diagnose error.log
  $ aws s3 ls 2>&1 | nxs cloud diagnose --stdin
  $ nxs cloud diagnose --interactive
  $ cat azure-error.txt | nxs cloud diagnose -s`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('AWS · GCP · Azure cloud debugger');
      await runAnalyze('cloud', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  cloud
    .command('history')
    .description('Show past cloud analyses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear cloud history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('AWS · GCP · Azure cloud debugger');
      await runHistory('cloud', opts);
    });

  cloud
    .command('providers')
    .description('List supported cloud providers and services')
    .action(() => {
      printBanner('AWS · GCP · Azure cloud debugger');
      console.log(chalk.bold('\n  Supported providers:\n'));

      const providers = [
        {
          name: 'AWS', color: chalk.hex('#FF9900'),
          services: ['EC2', 'S3', 'Lambda', 'IAM', 'RDS', 'ECS', 'EKS', 'CloudFormation', 'VPC', 'Route53'],
        },
        {
          name: 'GCP', color: chalk.hex('#4285F4'),
          services: ['Compute Engine', 'GKE', 'Cloud Run', 'BigQuery', 'Cloud Storage', 'Pub/Sub', 'Cloud SQL'],
        },
        {
          name: 'Azure', color: chalk.hex('#0078D4'),
          services: ['AKS', 'Blob Storage', 'Azure Functions', 'CosmosDB', 'ARM Templates', 'RBAC', 'ADF'],
        },
      ];

      providers.forEach(({ name, color, services }) => {
        console.log(`  ${color.bold(name)}`);
        console.log(chalk.dim('    ' + services.join('  ·  ')) + '\n');
      });

      console.log(chalk.dim('  Pipe any error from these services to: nxs cloud diagnose --stdin\n'));
    });
}
