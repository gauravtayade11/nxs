/**
 * nxs net — Network diagnostics analyzer
 * Supports: DNS failures, TLS/SSL errors, connection timeouts, curl/wget output
 */
import chalk from 'chalk';
import { printBanner, hr } from '../core/ui.js';
import { runAnalyze, runHistory } from '../core/runner.js';
import { run } from '../core/exec.js';

const SYSTEM_PROMPT = `You are a senior network and infrastructure engineer. Analyze the provided network error, DNS failure, TLS/SSL error, or connectivity issue output.

Return a JSON object with exactly this structure:

{
  "tool": "<dns|tls|timeout|http|firewall|unknown>",
  "severity": "<one of: critical, warning, info>",
  "target": "<the host, IP, or URL involved if detectable>",
  "summary": "<1-2 sentence plain-English summary of the network issue>",
  "rootCause": "<numbered breakdown: what layer failed (DNS/TCP/TLS/HTTP), why it failed>",
  "fixSteps": "<step-by-step diagnosis and fix — start with simplest check first>",
  "commands": "<exact diagnostic commands to run — nslookup, dig, curl, openssl, nc, telnet etc.>"
}

Severity rules:
- critical: service completely unreachable, cert expired blocking traffic, DNS resolution failing
- warning: intermittent failures, cert expiring soon, high latency, partial connectivity
- info: minor config issue, deprecation warning, non-blocking

Key patterns to detect:
- DNS: "Name or service not known", "NXDOMAIN", "SERVFAIL", "connection refused", "could not resolve"
- TLS/SSL: "certificate has expired", "SSL_ERROR", "certificate verify failed", "CERTIFICATE_VERIFY_FAILED", "ERR_CERT_*"
- Timeout: "Connection timed out", "i/o timeout", "context deadline exceeded", "ETIMEDOUT"
- HTTP errors: "502 Bad Gateway", "503 Service Unavailable", "connection reset by peer"
- Firewall/ACL: "No route to host", "Network unreachable", "ECONNREFUSED", "port unreachable"

Always suggest:
1. Layer-by-layer diagnosis (DNS → TCP → TLS → HTTP)
2. Exact commands with the real host/port from the error
3. Quick checks before deep investigation

Return ONLY valid JSON. No markdown fences.`;

const MOCK_RESPONSES = {
  dns: {
    tool: 'dns',
    severity: 'critical',
    target: 'api.internal',
    summary: 'DNS resolution failing for api.internal — host cannot be found. Service is completely unreachable.',
    rootCause: '1. DNS server cannot resolve the hostname "api.internal".\n2. The record may not exist in the DNS zone, or the DNS server being queried does not have authority for this domain.\n3. Possible causes: missing DNS record, wrong DNS server configured, DNS server down, or split-horizon DNS not configured for internal domains.',
    fixSteps: '- Check if the record exists: dig api.internal @your-dns-server\n- Verify your DNS server is reachable: nslookup api.internal\n- Check /etc/resolv.conf for correct nameserver entries\n- If internal DNS: ensure the pod/machine uses the internal DNS server, not a public one\n- In Kubernetes: check CoreDNS pods are running',
    commands: 'dig api.internal\nnslookup api.internal\ndig api.internal @8.8.8.8\ncat /etc/resolv.conf\nkubectl get pods -n kube-system | grep coredns\nkubectl logs -n kube-system -l k8s-app=kube-dns',
  },
  tls: {
    tool: 'tls',
    severity: 'critical',
    target: 'api.example.com',
    summary: 'TLS certificate has expired on api.example.com — all HTTPS connections are being rejected.',
    rootCause: '1. The TLS certificate for api.example.com has passed its expiry date.\n2. Clients enforcing certificate validation (all modern clients) will reject the connection.\n3. Auto-renewal may have failed (certbot/cert-manager cron job not running, DNS challenge failed, or rate limit hit).',
    fixSteps: '- Verify expiry: openssl s_client -connect api.example.com:443 | openssl x509 -noout -dates\n- If Let\'s Encrypt: run certbot renew manually\n- If cert-manager in K8s: check Certificate resource status\n- If cloud load balancer: rotate cert in AWS ACM / GCP Certificate Manager\n- Temporary: disable cert validation only for testing (never in production)',
    commands: 'openssl s_client -connect api.example.com:443 2>/dev/null | openssl x509 -noout -dates\ncurl -vI https://api.example.com 2>&1 | grep -E "expire|SSL|cert"\ncertbot renew --dry-run\nkubectl describe certificate my-cert -n default\nkubectl get certificaterequest -A',
  },
  timeout: {
    tool: 'timeout',
    severity: 'critical',
    target: 'db.internal:5432',
    summary: 'Connection to db.internal:5432 is timing out — TCP connection cannot be established.',
    rootCause: '1. No response from port 5432 on db.internal — the port is either closed, firewalled, or the host is unreachable.\n2. Possible causes: firewall rule blocking the port, service not listening, wrong IP/hostname, network routing issue.',
    fixSteps: '- Check if the host is reachable at all: ping db.internal\n- Check if the port is open: nc -zv db.internal 5432\n- Check firewall rules in your cloud provider (Security Groups, VPC firewall)\n- Verify the service is running on that host\n- Check if the hostname resolves to the correct IP',
    commands: 'ping -c 4 db.internal\nnc -zv db.internal 5432\ntelnet db.internal 5432\ncurl -v telnet://db.internal:5432\nnslookup db.internal\ntraceroute db.internal',
  },
  http: {
    tool: 'http',
    severity: 'warning',
    target: 'https://api.example.com/health',
    summary: '502 Bad Gateway — upstream service is down or not responding to the load balancer.',
    rootCause: '1. The load balancer/reverse proxy (nginx, ALB, ingress) cannot reach the upstream application.\n2. Application pods may be down, crashing, or not yet ready.\n3. Health check is failing, causing the upstream to be marked as unhealthy.',
    fixSteps: '- Check if upstream pods are running: kubectl get pods\n- Check pod logs for errors: kubectl logs <pod-name>\n- Check ingress/service configuration: kubectl describe ingress\n- Verify readiness probes are passing\n- Check if service selector matches pod labels',
    commands: 'kubectl get pods -l app=my-app\nkubectl logs -l app=my-app --tail=50\nkubectl describe ingress my-ingress\nkubectl get endpoints my-service\ncurl -v http://my-service.default.svc.cluster.local/health',
  },
};

function mockAnalyze(logText) {
  const lower = logText.toLowerCase();
  if (lower.includes('nxdomain') || lower.includes('name or service not known') || lower.includes('could not resolve') || lower.includes('dns')) return MOCK_RESPONSES.dns;
  if (lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls') || lower.includes('x509')) return MOCK_RESPONSES.tls;
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout') || lower.includes('i/o timeout')) return MOCK_RESPONSES.timeout;
  if (lower.includes('502') || lower.includes('503') || lower.includes('bad gateway') || lower.includes('connection reset')) return MOCK_RESPONSES.http;
  return MOCK_RESPONSES.timeout;
}

export function registerNet(program) {
  const net = program
    .command('net')
    .description('Diagnose network errors — DNS, TLS, timeouts, HTTP failures');

  net
    .command('diagnose [file]')
    .description('Analyze a network error or connectivity failure')
    .option('-s, --stdin', 'Read from stdin')
    .option('-i, --interactive', 'Paste error interactively')
    .option('--check <host>', 'Run live connectivity check against a host (ping + DNS + TCP + TLS)')
    .option('--port <port>', 'Port for --check (default: 443)')
    .option('--cert <host>', 'Check TLS certificate expiry for a host')
    .option('-j, --json', 'Output as JSON')
    .option('--no-chat', 'Skip follow-up chat')
    .option('--redact', 'Scrub secrets before sending to AI')
    .option('-o, --output <file>', 'Save analysis to a markdown file')
    .option('--fail-on <severity>', 'Exit code 1 if severity matches (critical|warning)')
    .addHelpText('after', `
Examples:
  $ curl -v https://api.internal 2>&1 | nxs net diagnose --stdin
  $ cat /var/log/nginx/error.log | nxs net diagnose --stdin
  $ nxs net diagnose --check api.internal --port 8080
  $ nxs net diagnose --cert api.example.com`)
    .action(async (file, opts) => {
      if (!opts.json) printBanner('Network diagnostics');

      // --cert: check TLS cert expiry
      if (opts.cert) {
        if (!opts.json) console.log(chalk.dim(`  Checking TLS certificate for: ${chalk.white(opts.cert)}\n`));
        const { stdout, stderr } = await run(
          `echo | openssl s_client -servername ${opts.cert} -connect ${opts.cert}:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>/dev/null`
        );
        const output = (stdout || stderr || '').trim();
        if (!output) {
          console.error(chalk.red(`  Could not connect to ${opts.cert}:443`));
          process.exit(1);
        }

        // parse expiry date
        const notAfterMatch = output.match(/notAfter=(.+)/);
        if (notAfterMatch) {
          const expiry = new Date(notAfterMatch[1]);
          const daysLeft = Math.floor((expiry - Date.now()) / 86400000);
          const color = daysLeft < 0 ? chalk.red : daysLeft < 14 ? chalk.yellow : chalk.green;
          console.log(chalk.bold(`  TLS Certificate: ${chalk.white(opts.cert)}\n`));
          console.log(output.split('\n').map(l => `  ${chalk.dim(l)}`).join('\n'));
          console.log(`\n  ${color(`● Expires in: ${daysLeft} days`)}  (${expiry.toDateString()})\n`);
          if (daysLeft < 0) {
            console.log(chalk.red('  EXPIRED — renew immediately\n'));
            process.exit(1);
          } else if (daysLeft < 14) {
            console.log(chalk.yellow('  Expiring soon — schedule renewal\n'));
          } else {
            console.log(chalk.green('  Certificate is valid\n'));
          }
        }
        return;
      }

      // --check: run live connectivity check
      if (opts.check) {
        const host = opts.check;
        const port = opts.port || '443';
        if (!opts.json) console.log(chalk.dim(`  Running connectivity check: ${chalk.white(`${host}:${port}`)}\n`));

        const checks = await Promise.all([
          run(`ping -c 2 -W 2 ${host} 2>&1`),
          run(`nslookup ${host} 2>&1`),
          run(`nc -zv -w 3 ${host} ${port} 2>&1`),
        ]);

        const [ping, dns, tcp] = checks;
        const combined = [
          `=== PING ===\n${ping.stdout || ping.stderr}`,
          `=== DNS ===\n${dns.stdout || dns.stderr}`,
          `=== TCP (port ${port}) ===\n${tcp.stdout || tcp.stderr}`,
        ].join('\n\n');

        await runAnalyze('net', SYSTEM_PROMPT, mockAnalyze, null, { ...opts, _injected: combined });
        return;
      }

      await runAnalyze('net', SYSTEM_PROMPT, mockAnalyze, file, opts);
    });

  net
    .command('history')
    .description('Show past network diagnoses')
    .option('-n, --limit <n>', 'Number of entries', '10')
    .option('--clear', 'Clear net history')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
      printBanner('Network diagnostics');
      await runHistory('net', opts);
    });

  net
    .command('errors')
    .description('Quick reference for common network errors')
    .action(() => {
      printBanner('Network diagnostics');
      console.log(chalk.bold('\n  Common network errors — what they mean\n'));
      console.log(hr());

      const errors = [
        { code: 'NXDOMAIN / Name not known',   layer: 'DNS',      tip: 'Hostname does not exist in DNS — check spelling, DNS server, record existence' },
        { code: 'ECONNREFUSED',                 layer: 'TCP',      tip: 'Port is closed or service is not listening — check if service is running' },
        { code: 'ETIMEDOUT / i/o timeout',      layer: 'TCP',      tip: 'Firewall blocking or host unreachable — check security groups / ACLs' },
        { code: 'Certificate has expired',      layer: 'TLS',      tip: 'Cert past expiry date — run certbot renew or rotate in cert-manager' },
        { code: 'certificate verify failed',    layer: 'TLS',      tip: 'Self-signed or untrusted CA — add CA bundle or use valid cert' },
        { code: '502 Bad Gateway',              layer: 'HTTP',     tip: 'Upstream app is down — check pod/container logs and readiness probes' },
        { code: '503 Service Unavailable',      layer: 'HTTP',     tip: 'No healthy upstreams — check pod count, HPA, or circuit breaker' },
        { code: 'No route to host',             layer: 'Network',  tip: 'Routing table issue or cross-VPC without peering — check network config' },
        { code: 'Connection reset by peer',     layer: 'TCP/HTTP', tip: 'Remote closed connection mid-stream — check server-side logs' },
        { code: 'SERVFAIL',                     layer: 'DNS',      tip: 'DNS server failed to answer — check DNS server health, CoreDNS logs' },
      ];

      const layerColor = {
        DNS: chalk.cyan, TCP: chalk.yellow, TLS: chalk.red,
        HTTP: chalk.hex('#FF9900'), Network: chalk.magenta, 'TCP/HTTP': chalk.yellow,
      };

      errors.forEach(({ code, layer, tip }) => {
        console.log(`\n  ${layerColor[layer](`[${layer}]`)}  ${chalk.bold.white(code)}`);
        console.log(chalk.dim(`    ${tip}`));
      });

      console.log('\n' + hr());
      console.log(chalk.dim('\n  Pipe any error to: curl -v https://host 2>&1 | nxs net diagnose --stdin\n'));
    });
}
