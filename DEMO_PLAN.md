# nxs — Demo Use Case Plan
# Worst Case · Good Case · Exception Case · Local Test Setup

> This plan covers every tool with 3 scenarios each:
> WORST (broken, critical failures), GOOD (healthy/passing), EXCEPTION (edge cases, bad input, failures)
> All test resources are created from scratch in your local docker-desktop cluster.

---

## Setup — Deploy All Demo Resources

Run this once before testing:

```bash
# Create namespaces
kubectl create namespace nxs-demo-bad   # broken workloads
kubectl create namespace nxs-demo-good  # healthy workloads

# Deploy everything
bash demo/setup.sh

# Verify
kubectl get pods -n nxs-demo-bad
kubectl get pods -n nxs-demo-good
```

---

## Tool 1 — nxs k8s

### WORST CASE — CrashLoopBackOff

**What it simulates:** App crashes immediately on startup (bad entrypoint)

```bash
# Deploy broken pod
kubectl apply -f demo/k8s/crash-loop.yaml

# Wait for crash
kubectl get pods -n nxs-demo-bad -w

# Test nxs — one command, no piping needed
nxs k8s debug --pod crash-loop-demo -n nxs-demo-bad --no-chat

# Expected: severity=critical, CrashLoopBackOff detected, fix commands
```

**Expected AI output:**
- severity: `critical`
- tool: `kubernetes`
- Root cause: invalid command / missing entrypoint
- Commands: `kubectl logs crash-loop-demo -n nxs-demo-bad --previous`

---

### WORST CASE — ImagePullBackOff

**What it simulates:** Wrong image name or private registry without credentials

```bash
kubectl apply -f demo/k8s/image-pull.yaml

nxs k8s debug --pod image-pull-demo -n nxs-demo-bad --no-chat

# Expected: ImagePullBackOff, suggests checking image name + imagePullSecrets
```

---

### WORST CASE — OOMKilled

**What it simulates:** App hits memory limit and gets killed

```bash
kubectl apply -f demo/k8s/oom-kill.yaml

# Wait for OOMKill (may take 30-60s)
kubectl get pods -n nxs-demo-bad -w

nxs k8s debug --pod oom-demo -n nxs-demo-bad --no-chat

# Expected: severity=critical, OOMKilled, suggests increasing memory limits
```

---

### WORST CASE — Pending pod

**What it simulates:** Pod stuck because of resource limits or bad node selector

```bash
kubectl apply -f demo/k8s/pending.yaml

nxs k8s debug --pod pending-demo -n nxs-demo-bad --no-chat

# Expected: severity=warning, scheduling failure, kubectl describe commands
```

---

### GOOD CASE — Healthy deployment

```bash
kubectl apply -f demo/k8s/healthy.yaml

nxs k8s debug --pod healthy-demo -n nxs-demo-good --no-chat

# Expected: severity=info, no critical issues found
```

---

### GOOD CASE — Full cluster status

```bash
nxs k8s status

nxs k8s status -n nxs-demo-bad   # see only broken namespace

nxs k8s pods --watch              # live view

# Expected: nodes Ready, unhealthy pods highlighted in red
```

---

### EXCEPTION CASES

```bash
# 1. Pod does not exist
nxs k8s debug --pod non-existent-pod -n nxs-demo-bad --no-chat
# Expected: "Pod 'non-existent-pod' not found" error, exit 1

# 2. Empty stdin (no input)
echo "" | nxs k8s debug --stdin --no-chat
# Expected: "No input from stdin" error, exit 1

# 3. Very short log (not enough context)
echo "error" | nxs k8s debug --stdin --no-chat
# Expected: AI gives generic advice, severity=info — acceptable

# 4. Binary/garbage input
dd if=/dev/urandom bs=100 count=1 2>/dev/null | nxs k8s debug --stdin --no-chat
# Expected: graceful error or low-quality but non-crashing response

# 5. Wrong namespace
nxs k8s debug --pod crash-loop-demo -n wrong-namespace --no-chat
# Expected: "Pod not found" error message, not a crash

# 6. kubectl not installed
# (test on a machine without kubectl)
# Expected: "kubectl not found" message, not a stack trace

# 7. --fail-on with good pod
nxs k8s debug --pod healthy-demo -n nxs-demo-good --no-chat --fail-on critical
echo "Exit: $?"
# Expected: analysis runs, exit code 0 (not critical)

# 8. --fail-on with crashing pod
nxs k8s debug --pod crash-loop-demo -n nxs-demo-bad --no-chat --fail-on critical
echo "Exit: $?"
# Expected: analysis runs, exit code 1
```

---

## Tool 2 — nxs devops

### WORST CASE — Docker build failure

```bash
cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat

# Expected: Docker detected, npm install failure root cause, fix commands
```

---

### WORST CASE — Terraform apply failure

```bash
cat demo/logs/devops/terraform-fail.log | nxs devops analyze --stdin --no-chat

# Expected: Terraform detected, invalid resource type, fix command with correct name
```

---

### WORST CASE — GitHub Actions CI failure

```bash
cat demo/logs/devops/ci-fail.log | nxs devops analyze --stdin --no-chat

# Expected: CI detected, npm test failure, specific file that failed
```

---

### WORST CASE — Live log watch

```bash
# Terminal 1
cp demo/logs/devops/watch-start.log /tmp/live-deploy.log
nxs devops watch /tmp/live-deploy.log --no-chat

# Terminal 2 (30 seconds later)
cat demo/logs/devops/watch-error.log >> /tmp/live-deploy.log

# Expected in Terminal 1: auto-triggers within 4s, analyzes the appended error
```

---

### GOOD CASE — Successful build

```bash
cat demo/logs/devops/docker-success.log | nxs devops analyze --stdin --no-chat

# Expected: severity=info, no issues, build completed successfully
```

---

### EXCEPTION CASES

```bash
# 1. File does not exist
nxs devops analyze non-existent.log --no-chat
# Expected: "File not found" error, exit 1

# 2. Empty file
echo "" | nxs devops analyze --stdin --no-chat
# Expected: "No input from stdin" error, exit 1

# 3. Log too large (over 50KB)
python3 -c "print('ERROR: some error\n' * 5000)" | nxs devops analyze --stdin --no-chat
# Expected: truncated to 8000 chars with notice, still analyzes successfully

# 4. --output to a read-only path
cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat --output /root/report.md
# Expected: "Permission denied" error, not a crash

# 5. --fail-on with good log
cat demo/logs/devops/docker-success.log | nxs devops analyze --stdin --no-chat --fail-on critical
echo "Exit: $?"
# Expected: exit 0

# 6. --fail-on with bad log
cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat --fail-on critical
echo "Exit: $?"
# Expected: exit 1

# 7. Watch on non-existent file
nxs devops watch /tmp/does-not-exist.log
# Expected: "File not found" error, exit 1

# 8. JSON output (for scripting)
cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat -j | jq '.severity'
# Expected: "critical" printed cleanly
```

---

## Tool 3 — nxs cloud

### WORST CASE — AWS AccessDenied

```bash
cat demo/logs/cloud/aws-denied.log | nxs cloud diagnose --stdin --no-chat

# Expected: AWS detected, IAM policy missing s3:GetObject, exact policy JSON to add
```

---

### WORST CASE — GCP Permission denied

```bash
cat demo/logs/cloud/gcp-denied.log | nxs cloud diagnose --stdin --no-chat

# Expected: GCP detected, missing run.services.create role, gcloud commands
```

---

### WORST CASE — Azure RBAC error

```bash
cat demo/logs/cloud/azure-denied.log | nxs cloud diagnose --stdin --no-chat

# Expected: Azure detected, missing role assignment, az cli commands
```

---

### GOOD CASE — Successful cloud operation

```bash
cat demo/logs/cloud/aws-success.log | nxs cloud diagnose --stdin --no-chat

# Expected: severity=info, operation completed successfully
```

---

### EXCEPTION CASES

```bash
# 1. Log contains secrets — without --redact (should warn)
cat demo/logs/cloud/aws-with-secrets.log | nxs cloud diagnose --stdin --no-chat
# Expected: warning "⚠ AWS Access Key detected — consider using --redact"

# 2. Same log WITH --redact (should scrub)
cat demo/logs/cloud/aws-with-secrets.log | nxs cloud diagnose --stdin --no-chat --redact
# Expected: "✓ Redacted 2 sensitive pattern type(s)" — then analysis without secrets

# 3. Ambiguous log (not clearly AWS/GCP/Azure)
echo "Error: permission denied accessing resource" | nxs cloud diagnose --stdin --no-chat
# Expected: best-effort analysis, tool=unknown acceptable

# 4. Non-cloud log piped to cloud tool
cat demo/logs/k8s/crash-loop.log | nxs cloud diagnose --stdin --no-chat
# Expected: AI notes this doesn't look like a cloud error, still gives analysis
```

---

## Tool 4 — nxs sec

### WORST CASE — Critical CVEs (Trivy output)

```bash
cat demo/logs/sec/trivy-critical.log | nxs sec scan --stdin --no-chat

# Expected: severity=critical, 3 CRITICAL CVEs, exact npm update / apt-get commands
```

---

### WORST CASE — Grype scan with HIGH vulns

```bash
cat demo/logs/sec/grype-high.log | nxs sec scan --stdin --no-chat

# Expected: severity=warning, HIGH vulns in Python deps, pip upgrade commands
```

---

### WORST CASE — Snyk finding

```bash
cat demo/logs/sec/snyk-report.log | nxs sec scan --stdin --no-chat

# Expected: Snyk detected, severity=warning, npm audit fix commands
```

---

### GOOD CASE — Clean scan (no vulns)

```bash
cat demo/logs/sec/trivy-clean.log | nxs sec scan --stdin --no-chat

# Expected: severity=info, "no critical/high vulnerabilities found"
```

---

### WORST CASE — Scan a running pod image

```bash
# Requires trivy installed
nxs sec scan --pod healthy-demo -n nxs-demo-good --no-chat

# Expected: fetches image from pod spec, runs trivy, analyzes output
```

---

### EXCEPTION CASES

```bash
# 1. --image flag but trivy not installed
# (uninstall trivy temporarily or test on a machine without it)
nxs sec scan --image nginx:latest --no-chat
# Expected: "trivy not found. Install: https://trivy.dev/..." — not a crash

# 2. Empty scan output
echo "" | nxs sec scan --stdin --no-chat
# Expected: "No input from stdin" error

# 3. Non-security log piped to sec
cat demo/logs/devops/docker-fail.log | nxs sec scan --stdin --no-chat
# Expected: AI notes this isn't a security scan, gives best-effort response

# 4. --fail-on critical with clean scan
cat demo/logs/sec/trivy-clean.log | nxs sec scan --stdin --no-chat --fail-on critical
echo "Exit: $?"
# Expected: exit 0

# 5. --fail-on critical with critical vulns
cat demo/logs/sec/trivy-critical.log | nxs sec scan --stdin --no-chat --fail-on critical
echo "Exit: $?"
# Expected: exit 1 — use this in CI pipelines
```

---

## Tool 5 — nxs net

### WORST CASE — DNS failure

```bash
cat demo/logs/net/dns-fail.log | nxs net diagnose --stdin --no-chat

# Expected: DNS detected, NXDOMAIN explained, dig/nslookup commands
```

---

### WORST CASE — TLS cert expired

```bash
cat demo/logs/net/tls-expired.log | nxs net diagnose --stdin --no-chat

# Expected: TLS detected, certificate expired, certbot renew commands
```

---

### WORST CASE — Connection timeout

```bash
cat demo/logs/net/timeout.log | nxs net diagnose --stdin --no-chat

# Expected: TCP timeout detected, firewall check, nc/ping/traceroute commands
```

---

### WORST CASE — 502 Bad Gateway

```bash
cat demo/logs/net/bad-gateway.log | nxs net diagnose --stdin --no-chat

# Expected: HTTP layer, upstream down, kubectl get pods + check readiness
```

---

### GOOD CASE — Successful connection

```bash
cat demo/logs/net/healthy.log | nxs net diagnose --stdin --no-chat

# Expected: severity=info, connection healthy
```

---

### GOOD CASE — Live cert check

```bash
# Check a real cert (uses openssl locally — no AI call)
nxs net diagnose --cert google.com

# Expected: cert details printed, days remaining shown in green (valid)
```

---

### EXCEPTION CASES

```bash
# 1. --cert on unreachable host
nxs net diagnose --cert this-does-not-exist-xyz.internal
# Expected: "Could not connect to this-does-not-exist-xyz.internal:443" — not a crash

# 2. --check with unreachable host (live check)
nxs net diagnose --check 192.168.255.255 --port 9999
# Expected: ping/DNS/TCP all fail gracefully, AI analyzes the failure output

# 3. --check with valid host
nxs net diagnose --check 8.8.8.8 --port 53
# Expected: ping/DNS/TCP succeed, severity=info

# 4. Garbage input
echo "aslkdjasldkjasldkj 1234 %%%%" | nxs net diagnose --stdin --no-chat
# Expected: AI gives best-effort response, does not crash

# 5. openssl not installed
# Expected: "--cert flag requires openssl" message, not a stack trace
```

---

## Tool 6 — nxs db

### WORST CASE — PostgreSQL too many connections

```bash
cat demo/logs/db/postgres-too-many-conn.log | nxs db diagnose --stdin --no-chat

# Expected: PostgreSQL detected, max_connections hit, PgBouncer recommendation
```

---

### WORST CASE — PostgreSQL auth failure

```bash
cat demo/logs/db/postgres-auth-fail.log | nxs db diagnose --stdin --no-chat

# Expected: auth failure, pg_hba.conf check, ALTER USER commands
```

---

### WORST CASE — MySQL lock timeout

```bash
cat demo/logs/db/mysql-lock-timeout.log | nxs db diagnose --stdin --no-chat

# Expected: MySQL detected, innodb lock wait, KILL trx commands
```

---

### WORST CASE — MongoDB replica set error

```bash
cat demo/logs/db/mongo-replica.log | nxs db diagnose --stdin --no-chat

# Expected: MongoDB detected, replica set issues, rs.status() commands
```

---

### WORST CASE — Redis OOM

```bash
cat demo/logs/db/redis-oom.log | nxs db diagnose --stdin --no-chat

# Expected: Redis detected, maxmemory hit, CONFIG SET maxmemory-policy commands
```

---

### GOOD CASE — Healthy DB log

```bash
cat demo/logs/db/postgres-healthy.log | nxs db diagnose --stdin --no-chat

# Expected: severity=info, no issues found
```

---

### EXCEPTION CASES

```bash
# 1. Secrets in DB log — password visible
cat demo/logs/db/postgres-with-password.log | nxs db diagnose --stdin --no-chat
# Expected: ⚠ warning about password detected, suggest --redact

# 2. Same with --redact
cat demo/logs/db/postgres-with-password.log | nxs db diagnose --stdin --no-chat --redact
# Expected: password scrubbed, analysis runs cleanly

# 3. Ambiguous DB error (could be any DB)
echo "connection refused to database server" | nxs db diagnose --stdin --no-chat
# Expected: best-effort response, asks for more context in chat

# 4. Non-DB log
cat demo/logs/k8s/crash-loop.log | nxs db diagnose --stdin --no-chat
# Expected: AI notes it doesn't look like a DB error, still helpful

# 5. Very long DB log (slow query log with thousands of lines)
python3 -c "print('2026-04-09 10:00:00 UTC [123]: LOG: duration: 5000.123 ms statement: SELECT * FROM large_table WHERE id > 1\n' * 3000)" \
  | nxs db diagnose --stdin --no-chat
# Expected: truncated to 8000 chars, analysis focuses on slow query pattern
```

---

## Global / System Exception Cases

```bash
# 1. No API key set at all
GROQ_API_KEY="" ANTHROPIC_API_KEY="" nxs devops analyze demo/logs/devops/docker-fail.log --no-chat
# Expected: falls back to MOCK mode, labelled clearly as mock, still gives output

# 2. Invalid API key
GROQ_API_KEY="invalid_key_xyz" nxs devops analyze demo/logs/devops/docker-fail.log --no-chat
# Expected: graceful AI error message, falls back to Anthropic then mock

# 3. Rate limit hit (Groq free tier)
# Run 5+ large analyses back to back
for i in 1 2 3 4 5; do
  cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat
done
# Expected: may hit "Request too large" — graceful error + truncation notice

# 4. Network completely offline
# Disconnect from internet, then run:
nxs devops analyze demo/logs/devops/docker-fail.log --no-chat
# Expected: "AI provider unreachable" error, falls back to mock

# 5. nxs history when no history exists
nxs history --clear
nxs history
# Expected: "No history yet. Try: nxs devops analyze error.log"

# 6. --json output piped to jq (scripting use case)
cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat -j | jq '{severity: .severity, summary: .summary}'
# Expected: clean JSON, no banner or spinner output

# 7. Ctrl+C during analysis (interrupt mid-request)
cat demo/logs/devops/ci-fail.log | nxs devops analyze --stdin
# Press Ctrl+C while "Analyzing..." spinner is running
# Expected: clean exit, no stack trace, cursor restored

# 8. Very short single-word input
echo "error" | nxs k8s debug --stdin --no-chat
# Expected: AI gives generic K8s advice, does not crash

# 9. Non-ASCII / Unicode characters in log
echo "❌ 错误: 无法连接到数据库服务器" | nxs db diagnose --stdin --no-chat
# Expected: handles Unicode, AI responds (may be generic)

# 10. Pipe closed immediately (empty stdin race condition)
nxs devops analyze --stdin --no-chat < /dev/null
# Expected: "No input from stdin" error, not a hang
```

---

## CI/CD Integration Test

Test the complete CI gate workflow:

```bash
# Step 1 — build fails → analyze → block deploy
cat demo/logs/devops/docker-fail.log | \
  nxs devops analyze --stdin --no-chat --fail-on critical --output /tmp/ci-report.md
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 1 ]; then
  echo "--- DEPLOY BLOCKED ---"
  echo "Report saved to /tmp/ci-report.md"
  cat /tmp/ci-report.md
fi

# Step 2 — security scan → block on critical CVEs
cat demo/logs/sec/trivy-critical.log | \
  nxs sec scan --stdin --no-chat --fail-on critical --output /tmp/sec-report.md
SEC_EXIT=$?

echo "Build gate: $BUILD_EXIT | Security gate: $SEC_EXIT"
# Expected: both exit 1, both reports saved
```

---

## Summary Table

| Tool | Worst Case | Good Case | Exceptions |
|------|-----------|-----------|------------|
| nxs k8s | CrashLoop, ImagePull, OOM, Pending | Healthy pod, status | Missing pod, empty input, no kubectl |
| nxs devops | Docker fail, Terraform, CI, watch | Successful build | Missing file, binary input, no key |
| nxs cloud | AWS/GCP/Azure denied | Successful op | Secrets in log, ambiguous log |
| nxs sec | Critical CVEs, HIGH vulns, Snyk | Clean scan | No trivy, empty output, wrong log |
| nxs net | DNS fail, TLS expired, timeout, 502 | Healthy conn, cert check | Unreachable host, no openssl |
| nxs db | PG too many conn, auth fail, MySQL lock, Mongo, Redis OOM | Healthy log | Secrets in log, non-DB input |
| Global | — | — | No API key, offline, rate limit, Ctrl+C, Unicode, empty stdin |
