# nxs — Manual Demo Plan

> Step-by-step walkthrough to test every feature from scratch.
> Each section is independent — you can run them in any order.

---

## Pre-flight checklist

Before starting, verify these are ready:

```bash
nxs --version              # should print 2.0.0
kubectl get nodes          # should show your cluster
gh auth status             # should show logged in
helm version --short       # should show v3.x
```

If `nxs` not found:
```bash
cd /path/to/this/repo
npm install
npm link
```

---

## 1. Welcome screen

**What you're testing:** banner, tool list, active AI provider

```bash
nxs
```

**Expected:** Box with `⚡ nxs v2.0.0`, lists devops / cloud / k8s / status tools, shows GROQ badge if key is set.

---

## 2. Full feature overview

**What you're testing:** `nxs info` — the "what is this" screen

```bash
nxs info
```

**Expected:** Sections for What is nxs, Tools, Real-world one-liners, Global commands, AI providers, Possible next features.

---

## 3. Config management

**What you're testing:** API key setup and display

```bash
# Show current provider
nxs config

# View saved keys (masked)
nxs config --get

# Set a key directly (use a fake key just to test the save)
nxs config --set TEST_KEY=abc123

# Verify it saved
nxs config --get

# Clean it up
nxs config --set TEST_KEY=
```

**Expected:** Keys show as `abc12••••123` format when listed.

---

## 4. nxs devops — Docker error

**What you're testing:** DevOps analysis via stdin

```bash
echo 'executor failed running [/bin/sh -c npm install]: exit code: 243
#16 3.241 npm warn saveError ENOENT: no such file or directory
#16 3.241 npm error code ENOENT
#16 3.241 npm error path /app/package.json' | nxs devops analyze --stdin --no-chat
```

**Expected:**
- `🔄 CI DETECTED`
- Summary: npm install failed
- Root cause: missing package.json or network issue
- Commands: `npm install --verbose`, `cat package.json`, etc.

---

## 5. nxs devops — Terraform error

**What you're testing:** Terraform-specific detection

```bash
echo 'Error: Invalid resource type "aws_s3_buckets"

  on main.tf line 12, in resource "aws_s3_buckets" "my_bucket":
  12: resource "aws_s3_buckets" "my_bucket" {

Did you mean "aws_s3_bucket"?' | nxs devops analyze --stdin --no-chat
```

**Expected:**
- `🏗  TERRAFORM DETECTED`
- Root cause: typo in resource type
- Fix: correct to `aws_s3_bucket`

---

## 6. nxs devops — Save output to file

**What you're testing:** `--output` flag generates a markdown report

```bash
echo 'Error: docker: Error response from daemon: pull access denied for myrepo/myapp, repository does not exist or may require authentication' | \
  nxs devops analyze --stdin --no-chat --output /tmp/docker-report.md

# View the saved file
cat /tmp/docker-report.md
```

**Expected:** Analysis printed to terminal AND `/tmp/docker-report.md` created with full markdown report including summary, root cause, fix steps, commands, and log excerpt.

---

## 7. nxs devops — CI gate (--fail-on)

**What you're testing:** Exit code 1 when severity matches — use this in CI pipelines

```bash
echo 'executor failed running [/bin/sh -c npm install]: exit code: 243' | \
  nxs devops analyze --stdin --no-chat --fail-on critical
echo "Exit code: $?"
```

**Expected:** Analysis runs, then prints `✗ Severity is 'critical' — exiting with code 1`, and `echo $?` prints `1`.

Try with a non-matching severity:
```bash
echo 'WARNING: deprecated API used in terraform config' | \
  nxs devops analyze --stdin --no-chat --fail-on critical
echo "Exit code: $?"
```
**Expected:** Analysis runs normally, exit code `0`.

---

## 8. nxs devops — Watch live log

**What you're testing:** `watch` command tails a file and auto-analyzes when errors appear

**Terminal 1 — start watcher:**
```bash
echo "app started successfully" > /tmp/live.log
nxs devops watch /tmp/live.log --no-chat
```

**Terminal 2 — simulate error appearing in the log:**
```bash
sleep 3
echo "ERROR: Failed to connect to database: connection refused (db.internal:5432)" >> /tmp/live.log
```

**Expected in Terminal 1:** Within ~4 seconds, `New errors detected — analyzing...` fires and gives a full analysis of the database connection error. Watcher stays running after.

Stop with `Ctrl+C`.

---

## 9. nxs devops — Examples

**What you're testing:** Built-in sample error one-liners

```bash
nxs devops examples
```

Pick one of the printed commands and run it to test.

---

## 10. nxs cloud — AWS AccessDenied

**What you're testing:** Cloud-specific IAM error analysis

```bash
echo 'An error occurred (AccessDenied) when calling the GetObject operation:
User: arn:aws:iam::123456789012:user/dev-user is not authorized to perform: s3:GetObject
on resource: arn:aws:s3:::prod-data-bucket/reports/q4.csv
because no resource-based policy allows the s3:GetObject action' | \
  nxs cloud diagnose --stdin --no-chat
```

**Expected:**
- `☁  AWS DETECTED`
- Root cause: IAM policy missing `s3:GetObject` for that resource
- Commands: `aws iam put-user-policy ...`, `aws s3api get-bucket-policy ...`

---

## 11. nxs cloud — GCP error

**What you're testing:** GCP detection

```bash
echo 'ERROR: (gcloud.run.deploy) PERMISSION_DENIED: Permission denied on resource project my-project.
Required permission: run.services.create
Caller does not have required permissions.' | \
  nxs cloud diagnose --stdin --no-chat
```

**Expected:** `🌐 GCP DETECTED`, root cause around missing `run.services.create` IAM role.

---

## 12. nxs cloud — Redact secrets before sending

**What you're testing:** `--redact` strips credentials from log before AI sees them

```bash
echo 'AccessDenied: User AKIAIOSFODNN7EXAMPLE calling s3:PutObject
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test.signature
password=prod_db_secret_123
mongodb://admin:hunter2@prod.db.internal:27017' | \
  nxs cloud diagnose --stdin --no-chat --redact
```

**Expected:**
- Warning: `⚠ Security notice:` lists detected patterns
- Then: `✓ Redacted 4 sensitive pattern type(s): AWS Access Key, Bearer token, ...`
- AI analysis runs but never saw the real secrets

Without `--redact` (passive warning only):
```bash
echo 'Error: AKIAIOSFODNN7EXAMPLE — access denied' | nxs cloud diagnose --stdin --no-chat
```
**Expected:** `⚠ Security notice: Possible AWS Access Key detected` — suggests using `--redact`.

---

## 13. nxs cloud — Providers list

```bash
nxs cloud providers
```

**Expected:** AWS / GCP / Azure with their supported services listed.

---

## 14. nxs k8s — Debug a pod by name (no piping)

**What you're testing:** `--pod` flag auto-fetches logs + describe

```bash
# Replace crash-demo / nextsight-demo with any pod/namespace in your cluster
nxs k8s debug --pod crash-demo -n nextsight-demo --no-chat
```

**Expected:** `Fetching logs + describe for pod: crash-demo` — then full analysis without any kubectl piping.

If you don't have a crashing pod, use any running pod:
```bash
kubectl get pods -A --no-headers | head -5   # pick any pod name + namespace
nxs k8s debug --pod <pod-name> -n <namespace> --no-chat
```

---

## 15. nxs k8s — Debug via stdin (pipe kubectl output)

**What you're testing:** Standard kubectl pipe workflow

```bash
# Option A: from describe
kubectl describe pod crash-demo -n nextsight-demo | nxs k8s debug --stdin --no-chat

# Option B: from logs
kubectl logs crash-demo -n nextsight-demo 2>&1 | nxs k8s debug --stdin --no-chat

# Option C: combine both for richer context
{ kubectl describe pod crash-demo -n nextsight-demo; \
  kubectl logs crash-demo -n nextsight-demo 2>&1; } | \
  nxs k8s debug --stdin --no-chat
```

---

## 16. nxs k8s — Cluster status

**What you're testing:** Live node, pod, deployment overview

```bash
# All namespaces
nxs k8s status

# Filter to a specific namespace
nxs k8s status -n kube-system

# Filter to your app namespace
nxs k8s status -n nextsight-demo
```

**Expected:** Nodes (Ready count), Pods (grouped, unhealthy highlighted in red), Deployments (healthy vs degraded), Recent warning events.

---

## 17. nxs k8s — Pod counts

**What you're testing:** Compact pod status view

```bash
# Snapshot
nxs k8s pods

# Filter namespace
nxs k8s pods -n kube-system

# Live — auto-refreshes every 5s
nxs k8s pods --watch
```

Stop watch with `Ctrl+C`.

**Expected:** Pods grouped by status (CrashLoopBackOff, Running, Pending etc.), unhealthy ones listed first with restart count.

---

## 18. nxs k8s — Error reference card

**What you're testing:** Quick lookup for common K8s errors

```bash
nxs k8s errors
```

**Expected:** ImagePullBackOff, CrashLoopBackOff, OOMKilled, Pending, CreateContainerErr, Evicted, Terminating, ErrImageNeverPull — each with severity and tip.

---

## 19. nxs status — Full live dashboard

**What you're testing:** Unified view of cluster + pipelines + helm

```bash
# Full dashboard
nxs status

# K8s only
nxs status --only k8s

# Helm releases only
nxs status --only helm

# Pipelines only (needs gh CLI + a GitHub repo remote, or -r flag)
nxs status --only pipelines

# Pipelines for a specific repo
nxs status --only pipelines -r gauravtayade11/codopsgt-docs
```

---

## 20. nxs devops — Pipelines

**What you're testing:** GitHub Actions run status

```bash
# Auto-detect from git remote (only works inside a repo with remote set)
nxs devops pipelines

# Specify a repo
nxs devops pipelines -r gauravtayade11/sonarqube-report

# Live refresh every 30s
nxs devops pipelines -r gauravtayade11/codopsgt-docs --watch
```

Stop watch with `Ctrl+C`.

---

## 21. History — across all tools

**What you're testing:** History is saved per-tool and shown globally

```bash
# After running several analyses above, check history
nxs history

# Limit entries
nxs history -n 5

# JSON output (for scripting)
nxs history -j

# Tool-specific history
nxs k8s history
nxs devops history
nxs cloud history

# Clear all
nxs history --clear
```

---

## 22. Follow-up chat (Ask AI)

**What you're testing:** Post-analysis Q&A

Run any analysis **without** `--no-chat`:

```bash
echo 'ImagePullBackOff: Back-off pulling image myregistry.io/myapp:v2.1.0' | \
  nxs k8s debug --stdin
```

After the analysis prints, you'll see:
```
💬 Ask a follow-up question (or press Enter to exit):

  You ›
```

Try asking:
- `How do I create an imagePullSecret for a private registry?`
- `What exact kubectl command patches the deployment to fix this?`
- `What does imagePullPolicy: Always do?`

Press **Enter** on an empty line to exit the chat.

---

## 23. Real-world end-to-end scenario

**Scenario:** On-call alert fires — pod crashing in production

```bash
# Step 1 — get the dashboard snapshot
nxs status --only k8s

# Step 2 — see the crashing pod, debug it immediately
nxs k8s debug --pod crash-demo -n nextsight-demo --no-chat --output ~/crash-demo-analysis.md

# Step 3 — save a report for the ticket
cat ~/crash-demo-analysis.md

# Step 4 — check if same issue was seen before
nxs k8s history

# Step 5 — share the markdown file with your team
```

---

## Cheat sheet — all one-liners

```bash
# Debug any pod instantly
nxs k8s debug --pod <pod> -n <ns> --no-chat

# Debug Docker build failure
docker build . 2>&1 | nxs devops analyze --stdin --no-chat

# Debug failed GitHub Actions
gh run view <run-id> --log-failed | nxs devops analyze --stdin --no-chat

# Debug AWS error
aws s3 ls s3://my-bucket 2>&1 | nxs cloud diagnose --stdin --no-chat

# Debug Terraform
terraform apply 2>&1 | nxs devops analyze --stdin --no-chat

# Save report
... | nxs devops analyze --stdin --no-chat --output report.md

# CI gate — fail build if critical
... | nxs devops analyze --stdin --no-chat --fail-on critical

# Watch live log
nxs devops watch /var/log/app.log --no-chat

# Live pod dashboard
nxs k8s pods --watch

# Full infra snapshot
nxs status
```
