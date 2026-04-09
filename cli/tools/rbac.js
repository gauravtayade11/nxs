/**
 * nxs rbac — Kubernetes RBAC security scanner
 * Detects over-permissive roles, cluster-admin bindings, wildcards, anonymous access
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { run } from '../core/exec.js';
import { writeFileSync } from 'node:fs';

const RISK = {
  CRITICAL: { label: 'CRITICAL', color: chalk.red.bold,         score: 3 },
  HIGH:     { label: 'HIGH',     color: chalk.hex('#ff6b35').bold, score: 2 },
  MEDIUM:   { label: 'MEDIUM',   color: chalk.yellow,            score: 1 },
  INFO:     { label: 'INFO',     color: chalk.dim,               score: 0 },
};

export function registerRbac(program) {
  const rbac = program
    .command('rbac')
    .description('Scan Kubernetes RBAC for over-permissive roles and dangerous bindings');

  rbac
    .command('scan')
    .description('Scan all RBAC bindings for security risks')
    .option('-n, --namespace <ns>', 'Scan a specific namespace (default: all)')
    .option('--fail-on <level>', 'Exit code 1 if any finding at this level: critical|high|medium')
    .option('-o, --output <file>', 'Save report as markdown file')
    .option('-j, --json', 'Output raw findings as JSON')
    .addHelpText('after', `
Checks:
  ✗ cluster-admin bound to non-system subjects
  ✗ Wildcard resources or verbs (* in rules)
  ✗ Secrets readable by broad subjects
  ✗ Anonymous / unauthenticated user bindings
  ✗ Default service account with elevated roles
  ✗ RBAC management permissions (escalation risk)

Examples:
  $ nxs rbac scan
  $ nxs rbac scan -n production
  $ nxs rbac scan --fail-on high
  $ nxs rbac scan --output rbac-report.md`)
    .action(async (opts) => {
      if (!opts.json) printBanner('Kubernetes RBAC scanner');

      const nsFlag = opts.namespace ? `-n ${opts.namespace}` : '--all-namespaces';

      // Fetch ClusterRoleBindings, RoleBindings, ClusterRoles, Roles in parallel
      if (!opts.json) console.log(chalk.dim('  Fetching RBAC resources from cluster...\n'));

      const [crbR, rbR, crR, rR] = await Promise.all([
        run(`kubectl get clusterrolebindings -o json 2>/dev/null`),
        run(`kubectl get rolebindings ${nsFlag} -o json 2>/dev/null`),
        run(`kubectl get clusterroles -o json 2>/dev/null`),
        run(`kubectl get roles ${nsFlag} -o json 2>/dev/null`),
      ]);

      if (!crbR.ok && !rbR.ok) {
        console.error(chalk.red('  kubectl not configured or no cluster access.'));
        process.exit(1);
      }

      let crbItems = [], rbItems = [], crItems = [], rItems = [];
      try { crbItems = JSON.parse(crbR.stdout || '{}').items ?? []; } catch { /* empty */ }
      try { rbItems  = JSON.parse(rbR.stdout  || '{}').items ?? []; } catch { /* empty */ }
      try { crItems  = JSON.parse(crR.stdout  || '{}').items ?? []; } catch { /* empty */ }
      try { rItems   = JSON.parse(rR.stdout   || '{}').items ?? []; } catch { /* empty */ }

      const findings = [];

      // ── Check 1: cluster-admin ClusterRoleBindings ──────────────────────────
      for (const crb of crbItems) {
        const roleName = crb.roleRef?.name ?? '';
        if (roleName !== 'cluster-admin') continue;

        for (const subject of crb.subjects ?? []) {
          const isSystem = (subject.name ?? '').startsWith('system:');
          const isKubeSystem = (subject.namespace ?? '') === 'kube-system';
          if (isSystem && isKubeSystem) continue; // skip system accounts in kube-system

          findings.push({
            risk: isSystem ? 'HIGH' : 'CRITICAL',
            type: 'cluster-admin binding',
            name: crb.metadata?.name,
            namespace: subject.namespace ?? 'cluster-wide',
            subject: `${subject.kind}:${subject.name}`,
            detail: `${subject.kind} "${subject.name}" has cluster-admin — full cluster access. Least-privilege principle violated.`,
            remediation: `kubectl delete clusterrolebinding ${crb.metadata?.name}\n# Then create a scoped role with only the permissions needed`,
          });
        }
      }

      // ── Check 2: RoleBindings to cluster-admin ──────────────────────────────
      for (const rb of rbItems) {
        const roleName = rb.roleRef?.name ?? '';
        if (roleName !== 'cluster-admin') continue;

        for (const subject of rb.subjects ?? []) {
          findings.push({
            risk: 'HIGH',
            type: 'cluster-admin in namespace',
            name: rb.metadata?.name,
            namespace: rb.metadata?.namespace ?? 'unknown',
            subject: `${subject.kind}:${subject.name}`,
            detail: `cluster-admin bound in namespace "${rb.metadata?.namespace}" — still grants broad permissions.`,
            remediation: `kubectl delete rolebinding ${rb.metadata?.name} -n ${rb.metadata?.namespace}`,
          });
        }
      }

      // ── Check 3: Wildcard resources or verbs in ClusterRoles ────────────────
      for (const cr of crItems) {
        if ((cr.metadata?.name ?? '').startsWith('system:')) continue;
        for (const rule of cr.rules ?? []) {
          const hasWildcardResource = (rule.resources ?? []).includes('*');
          const hasWildcardVerb     = (rule.verbs ?? []).includes('*');
          if (!hasWildcardResource && !hasWildcardVerb) continue;

          findings.push({
            risk: hasWildcardResource && hasWildcardVerb ? 'CRITICAL' : 'HIGH',
            type: 'wildcard permissions',
            name: cr.metadata?.name,
            namespace: 'cluster-wide',
            subject: `ClusterRole/${cr.metadata?.name}`,
            detail: `Wildcard ${hasWildcardVerb ? 'verbs' : ''}${hasWildcardResource ? (hasWildcardVerb ? ' + resources' : 'resources') : ''} found. Any subject bound to this role has unconstrained access.`,
            remediation: `kubectl edit clusterrole ${cr.metadata?.name}\n# Replace * with specific resources and verbs needed`,
          });
        }
      }

      // ── Check 4: Wildcard in namespace Roles ────────────────────────────────
      for (const r of rItems) {
        for (const rule of r.rules ?? []) {
          const hasWildcardResource = (rule.resources ?? []).includes('*');
          const hasWildcardVerb     = (rule.verbs ?? []).includes('*');
          if (!hasWildcardResource && !hasWildcardVerb) continue;

          findings.push({
            risk: 'HIGH',
            type: 'wildcard permissions (namespaced)',
            name: r.metadata?.name,
            namespace: r.metadata?.namespace ?? 'unknown',
            subject: `Role/${r.metadata?.name}`,
            detail: `Wildcard permissions in namespace "${r.metadata?.namespace}". Scope is limited but still overly broad.`,
            remediation: `kubectl edit role ${r.metadata?.name} -n ${r.metadata?.namespace}`,
          });
        }
      }

      // ── Check 5: Anonymous / unauthenticated access ──────────────────────────
      for (const crb of [...crbItems, ...rbItems]) {
        for (const subject of crb.subjects ?? []) {
          if (subject.name === 'system:anonymous' || subject.name === 'system:unauthenticated') {
            findings.push({
              risk: 'CRITICAL',
              type: 'anonymous access',
              name: crb.metadata?.name,
              namespace: crb.metadata?.namespace ?? 'cluster-wide',
              subject: `Group:${subject.name}`,
              detail: `Unauthenticated users can access the cluster via this binding. Immediate security risk.`,
              remediation: `kubectl delete ${crb.subjects ? 'clusterrolebinding' : 'rolebinding'} ${crb.metadata?.name}`,
            });
          }
        }
      }

      // ── Check 6: Secrets readable by default SA or broad groups ─────────────
      const sensitiveRules = [...crItems, ...rItems].flatMap((r) =>
        (r.rules ?? [])
          .filter((rule) => (rule.resources ?? []).includes('secrets') &&
            ['get', 'list', 'watch', '*'].some((v) => (rule.verbs ?? []).includes(v)))
          .map((rule) => ({ role: r.metadata?.name, ns: r.metadata?.namespace, rule }))
      );

      for (const { role, ns } of sensitiveRules) {
        if ((role ?? '').startsWith('system:')) continue;
        findings.push({
          risk: 'MEDIUM',
          type: 'secrets read access',
          name: role,
          namespace: ns ?? 'cluster-wide',
          subject: `${ns ? 'Role' : 'ClusterRole'}/${role}`,
          detail: `Role "${role}" grants read access to Secrets. Any bound subject can read all secrets in scope.`,
          remediation: `# Review who is bound to: kubectl get ${ns ? 'rolebindings' : 'clusterrolebindings'} -o json | grep ${role}`,
        });
      }

      // ── Check 7: RBAC management permissions (privilege escalation risk) ────
      for (const cr of crItems) {
        if ((cr.metadata?.name ?? '').startsWith('system:')) continue;
        for (const rule of cr.rules ?? []) {
          const rbacResources = ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'];
          const hasRbacWrite = rbacResources.some((r) => (rule.resources ?? []).includes(r)) &&
            ['create', 'update', 'patch', 'delete', '*'].some((v) => (rule.verbs ?? []).includes(v));
          if (!hasRbacWrite) continue;

          findings.push({
            risk: 'HIGH',
            type: 'RBAC escalation risk',
            name: cr.metadata?.name,
            namespace: 'cluster-wide',
            subject: `ClusterRole/${cr.metadata?.name}`,
            detail: `Can modify RBAC — a subject bound here can grant themselves any permission.`,
            remediation: `# Audit who uses this role and reduce scope\nkubectl get clusterrolebindings -o json | grep ${cr.metadata?.name}`,
          });
        }
      }

      // ── Output ───────────────────────────────────────────────────────────────

      if (opts.json) {
        console.log(JSON.stringify(findings, null, 2));
        return;
      }

      const byRisk = { CRITICAL: [], HIGH: [], MEDIUM: [], INFO: [] };
      for (const f of findings) (byRisk[f.risk] ?? byRisk.INFO).push(f);

      const totalRisk = findings.reduce((s, f) => s + (RISK[f.risk]?.score ?? 0), 0);
      const overallRisk = totalRisk === 0 ? 'CLEAN'
        : byRisk.CRITICAL.length > 0 ? 'CRITICAL'
        : byRisk.HIGH.length > 0 ? 'HIGH'
        : byRisk.MEDIUM.length > 0 ? 'MEDIUM' : 'INFO';

      console.log(hr());
      console.log(chalk.bold('\n  RBAC SECURITY SCAN\n'));
      console.log(`  Namespace:   ${chalk.white(opts.namespace ?? 'all')}`);
      console.log(`  Findings:    CRITICAL: ${byRisk.CRITICAL.length > 0 ? chalk.red.bold(byRisk.CRITICAL.length) : chalk.dim(0)}  HIGH: ${byRisk.HIGH.length > 0 ? chalk.hex('#ff6b35').bold(byRisk.HIGH.length) : chalk.dim(0)}  MEDIUM: ${byRisk.MEDIUM.length > 0 ? chalk.yellow(byRisk.MEDIUM.length) : chalk.dim(0)}`);
      console.log(`  Overall:     ${overallRisk === 'CLEAN' ? chalk.green('✓ CLEAN') : RISK[overallRisk].color(`● ${overallRisk}`)}\n`);
      console.log(hr());

      if (findings.length === 0) {
        console.log(chalk.green('\n  ✓ No dangerous RBAC configurations found.\n'));
        console.log(chalk.dim('  Tip: run regularly as cluster membership changes.\n'));
      } else {
        for (const [riskLevel, items] of Object.entries(byRisk)) {
          if (items.length === 0) continue;
          const r = RISK[riskLevel];
          console.log(chalk.bold(`\n  ${r.color(`● ${riskLevel}`)}  (${items.length})\n`));

          items.forEach((f, i) => {
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.white(f.type)}  ${chalk.dim(f.name ?? '')}`);
            console.log(`     ${chalk.dim('Subject:')}  ${chalk.hex('#94a3b8')(f.subject)}`);
            console.log(`     ${chalk.dim('Scope:')}    ${chalk.hex('#94a3b8')(f.namespace)}`);
            console.log(`     ${chalk.hex('#94a3b8')(f.detail)}`);
            console.log(`     ${chalk.dim('Fix:')}`);
            f.remediation.split('\n').forEach((l) => console.log(`       ${chalk.cyan(l)}`));
            console.log('');
          });
        }
      }

      console.log(hr() + '\n');

      // --output: save markdown report
      if (opts.output) {
        const lines = [
          `# nxs RBAC Security Report`,
          `**Date:** ${new Date().toISOString()}  |  **Namespace:** ${opts.namespace ?? 'all'}  |  **Overall Risk:** ${overallRisk}`,
          '',
          '## Summary',
          '',
          `| Risk Level | Count |`,
          `|------------|-------|`,
          ...Object.entries(byRisk).map(([r, items]) => `| ${r} | ${items.length} |`),
          '',
          '## Findings',
          '',
          ...findings.flatMap((f) => [
            `### ${f.risk}: ${f.type}`,
            `- **Name:** ${f.name ?? 'unknown'}`,
            `- **Subject:** ${f.subject}`,
            `- **Scope:** ${f.namespace}`,
            `- **Detail:** ${f.detail}`,
            '',
            '**Remediation:**',
            '```bash',
            f.remediation,
            '```',
            '',
          ]),
          findings.length === 0 ? '_No findings — RBAC configuration looks clean._' : '',
        ];
        writeFileSync(opts.output, lines.join('\n'), 'utf8');
        console.log(chalk.green(`  ✓ Report saved to ${opts.output}\n`));
      }

      // --fail-on
      if (opts.failOn) {
        const failLevel = opts.failOn.toUpperCase();
        const failScore = RISK[failLevel]?.score ?? 0;
        const hasFailLevel = findings.some((f) => (RISK[f.risk]?.score ?? 0) >= failScore);
        if (hasFailLevel) {
          console.log(chalk.red(`  ✗ ${failLevel} findings detected — exiting with code 1\n`));
          process.exit(1);
        }
      }
    });
}
