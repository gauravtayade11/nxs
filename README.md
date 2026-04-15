# ⚡ nxs — Fix Kubernetes & CI/CD Errors Instantly

[![npm](https://img.shields.io/npm/v/@nextsight/nxs-cli)](https://www.npmjs.com/package/@nextsight/nxs-cli)
[![npm downloads](https://img.shields.io/npm/dm/@nextsight/nxs-cli)](https://www.npmjs.com/package/@nextsight/nxs-cli)
[![CI](https://github.com/gauravtayade11/nxs/actions/workflows/ci.yml/badge.svg)](https://github.com/gauravtayade11/nxs/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/gauravtayade11/nxs?style=social)](https://github.com/gauravtayade11/nxs)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=gauravtayade11_nxs&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=gauravtayade11_nxs)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=gauravtayade11_nxs&metric=coverage)](https://sonarcloud.io/summary/new_code?id=gauravtayade11_nxs)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=gauravtayade11_nxs&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=gauravtayade11_nxs)

> Paste any DevOps error → get root cause + exact fix command in seconds.

```bash
npm install -g @nextsight/nxs-cli
kubectl logs my-pod --previous | nxs k8s debug --stdin
```

---

## Demo

```bash
kubectl logs my-pod --previous | nxs k8s debug --stdin
```

```
 RULES ENGINE   Confidence: ███████████████████░ 95%

Issue:      CrashLoopBackOff
Severity:   Critical
Impact:     Pod is unavailable. Service is down until fixed.

Root Cause:
  1. Application exits on startup (missing env var or config)
  2. Liveness probe firing before app is ready
  3. Port conflict inside the container

Fix Steps:
  ✓ kubectl logs my-pod --previous
  ✓ Verify all env vars and secrets are mounted
  ✓ Increase initialDelaySeconds on liveness probe

Commands:
  ┌─ shell ──────────────────────────────────────────────┐
  │ kubectl logs my-pod --previous                       │
  │ kubectl describe pod my-pod                          │
  │ kubectl get pod my-pod -o yaml | grep -A10 liveness  │
  └──────────────────────────────────────────────────────┘

Suggestions:
  › Add a startupProbe so liveness doesn't fire during slow init
  › Set memory requests/limits to avoid OOMKill on startup
```

---

## What is nxs?

**nxs** is an AI-powered DevOps CLI. It reads any error log and gives you:

- **What** broke — plain English summary
- **Why** it broke — numbered root cause
- **How** to fix it — copy-paste commands
- **Confidence score** — how certain the diagnosis is
- **Impact** — what's actually down and for how long
- **Suggestions** — proactive improvements beyond the immediate fix

Works with **Groq** (free), **Anthropic Claude**, or **no key at all** — a built-in rule engine handles the 20 most common errors instantly without any API call.

---

## Why nxs?

| Without nxs | With nxs |
|---|---|
| Read 500+ lines of logs | Instant summary |
| Google → StackOverflow → trial and error | Direct fix command |
| Hours to find root cause | Seconds |
| Silent CI failures | Slack alert with AI diagnosis |
| Manual postmortems | AI-generated postmortem |

- Works entirely in your terminal — no browser, no dashboard
- Rule engine + AI hybrid — fast for known errors, smart for unknown ones
- Kubernetes, CI/CD, Docker, Terraform, Cloud, Security — one tool
- Auto Slack alerts with root cause and confidence score
- Run as a CLI or a REST API server for your team

---

## Install

```bash
npm install -g @nextsight/nxs-cli   # requires Node.js 18+
nxs config --setup                  # add a free Groq key (or skip — demo mode works)
```

**Optional CLIs** (nxs warns if missing, only needed for live cluster features):

| CLI | Used by |
|-----|---------|
| `kubectl` | k8s debug, predict, autopilot, sec cluster, rbac, status |
| `gh` | ci analyze --run, ci analyze --latest, devops pipelines |
| `trivy` | sec scan --image, sec cluster |
| `helm` | status --only helm |

---

## How it Works

```
Log input
    ↓
Rule Engine  ←── 20 built-in patterns (instant, no API)
    ↓ no match
AI Engine    ←── Groq → Claude → mock (auto-fallback)
    ↓
Structured output: summary · confidence · impact · root cause · fix · suggestions
    ↓
Slack / JSON / markdown (optional)
```

Use `--fast` on any command to force rules-only mode — zero API calls, works offline.

---

## Core Tools

### `nxs k8s` — Kubernetes Debugging

```bash
# Debug from a log file or stdin
nxs k8s debug <file>
kubectl logs my-pod --previous | nxs k8s debug --stdin

# Auto-fetch logs + describe — no piping needed
nxs k8s debug --pod my-pod -n production
nxs k8s debug --deployment my-app -n production

# Cluster-wide event triage
nxs k8s events
nxs k8s events -n production --warnings-only
nxs k8s events --since 30m

# Live pod health view
nxs k8s status [-n namespace]
nxs k8s pods [--watch]

# Error reference card
nxs k8s errors
```

Detects: CrashLoopBackOff, OOMKilled, ImagePullBackOff, Pending, CreateContainerError,
Evicted, node NotReady, RBAC forbidden, PVC unbound

---

### `nxs ci` — CI/CD Pipeline Failures

```bash
# Analyze a log file
nxs ci analyze build.log

# Auto-fetch most recent failed run (no run ID needed)
nxs ci analyze --latest

# Fetch a specific run via gh CLI
nxs ci analyze --run 12345

# From stdin + gate the pipeline
gh run view 12345 --log-failed | nxs ci analyze --stdin --fail-on critical

# Analyze + notify Slack
nxs ci analyze --latest --notify slack
```

Detects: GitHub Actions, GitLab CI, Jenkins, CircleCI — test failures, Docker auth,
missing modules, syntax errors, OOM, timeouts, permission denied, Terraform errors

**Auto-notify on pipeline failure** — add to `.github/workflows/ci.yml`:

```yaml
notify-failure:
  needs: [build, test]
  if: failure()
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g @nextsight/nxs-cli
    - run: |
        {
          echo "Workflow: ${{ github.workflow }}"
          echo "Branch: ${{ github.ref_name }}"
          echo "Run URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          gh run view ${{ github.run_id }} 2>&1 || true
        } | nxs ci analyze --stdin --notify slack --json || true
      env:
        GH_TOKEN: ${{ github.token }}
        GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

### `nxs devops` — Docker · Terraform · Pipelines

```bash
# Analyze any DevOps log
docker build . 2>&1 | nxs devops analyze --stdin
terraform apply 2>&1 | nxs devops analyze --stdin
nxs devops analyze build.log

# GitHub Actions run status
nxs devops pipelines
nxs devops pipelines --watch

nxs devops history
```

---

## Real-World Commands

```bash
# Debug a crashing pod
kubectl logs my-pod --previous | nxs k8s debug --stdin

# Debug and notify Slack
kubectl logs my-pod --previous | nxs k8s debug --stdin --notify slack

# Save full analysis as a markdown report
kubectl describe pod my-pod | nxs k8s debug --stdin --output report.md

# Instant diagnosis — no API key needed (rules engine only)
kubectl logs my-pod --previous | nxs k8s debug --stdin --fast

# Latest CI failure, analyzed + sent to Slack
nxs ci analyze --latest --notify slack

# Gate your CI pipeline — exit 1 on critical
nxs devops analyze build.log --fail-on critical

# Explain any error you encounter
nxs explain OOMKilled
nxs explain "Terraform state lock"
nxs explain CrashLoopBackOff

# Weekly digest posted to Slack
nxs report --days 7 --notify slack
```

---

## Advanced Tools

### `nxs predict` — Failure Prediction

Detects at-risk pods **before** they crash — high memory, OOMKill state, restart trends, node pressure, unbound PVCs.

```bash
nxs predict                        # scan all namespaces
nxs predict -n production          # specific namespace
nxs predict --threshold 80         # warn above 80% of limit
nxs predict --ai                   # AI deep-dive analysis
nxs predict --watch                # continuous monitor (re-scan every 5m)
nxs predict --watch --interval 2   # custom interval
```

---

### `nxs autopilot` — Self-Healing

Watches for unhealthy pods, proposes fixes, applies them — with your confirmation or automatically.
Safe fixes: restart crashed pods, increase memory on OOMKill.

```bash
nxs autopilot -n production        # watch + confirm before fixing
nxs autopilot -n staging --auto    # auto-apply safe fixes
nxs autopilot --dry-run            # show what would change
nxs autopilot --once               # one scan, then exit
```

---

### `nxs incident` — Incident Commander

Full incident lifecycle from the terminal. Slack threading at every stage.
AI-generated postmortem with root cause, timeline, and prevention items.

```bash
nxs incident start --title "API down" --severity critical
nxs incident update <id> --note "Root cause: DB pool exhausted"
nxs incident close  <id> --resolution "Increased pool size to 50"
nxs incident list
nxs incident postmortem <id>                    # AI-generated
nxs incident postmortem <id> --output post.md   # save as markdown
```

---

### `nxs watch` — Live Log Monitor

Tails a file or streams a command — runs AI analysis on every detected error.

```bash
nxs watch /var/log/app.log
nxs watch "kubectl logs -f my-pod -n production"
nxs watch "docker logs -f my-container" --notify slack
nxs watch app.log --severity critical       # only trigger AI on FATAL/OOM/panic
nxs watch app.log --cooldown 120            # min 120s between AI calls
```

---

### `nxs sec` — Security Scanning

```bash
nxs sec scan <file/--stdin>                  # analyze Trivy/Grype/Snyk output
nxs sec scan --image nginx:latest            # scan a Docker image directly
nxs sec scan --pod my-pod -n production      # auto-detect pod image + scan
nxs sec cluster [-n namespace]               # scan ALL images in the cluster
nxs sec cluster --detailed --severity HIGH
```

---

### `nxs rbac` — Kubernetes RBAC Audit

```bash
nxs rbac scan                          # scan current cluster
nxs rbac scan -n production            # specific namespace
nxs rbac scan --fail-on critical       # exit 1 if critical findings (use in CI)
```

Checks: cluster-admin wildcard bindings, anonymous access, default SA over-permissions

---

### `nxs status` — Live Dashboard

```bash
nxs status                             # cluster + pipelines + helm
nxs status --only k8s
nxs status --only pipelines
nxs status -n <namespace>
```

---

### `nxs net` / `nxs db` / `nxs cloud`

```bash
# Network: DNS, TLS, timeouts, HTTP
nxs net diagnose <file/--stdin>
nxs net diagnose --check api.example.com
nxs net diagnose --cert api.example.com

# Database: PostgreSQL, MySQL, MongoDB, Redis
nxs db diagnose <file/--stdin>

# Cloud: AWS, GCP, Azure IAM and API errors
nxs cloud diagnose <file/--stdin>
nxs cloud providers
```

---

## Integrations

### Slack

Set `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN` + `SLACK_CHANNEL`.
Every analysis result can include: severity, confidence score, root cause, fix commands, and suggestions.

```bash
kubectl logs my-pod --previous | nxs k8s debug --stdin --notify slack
nxs incident start --title "DB down" --severity critical  # auto-posts to Slack
```

### Prometheus Alertmanager

```yaml
# alertmanager.yml
receivers:
  - name: nxs
    webhook_configs:
      - url: http://<your-nxs-server>:4000/webhook/alertmanager
route:
  receiver: nxs
```

Every Prometheus alert is automatically AI-diagnosed and posted to Slack.

### REST API — `nxs serve`

Run nxs as a server for your team or CI/CD pipelines.

```bash
NXS_API_KEY=secret SLACK_WEBHOOK_URL=https://... nxs serve --port 4000
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/analyze` | `{ tool, log }` → analysis JSON |
| `GET` | `/history` | Past analyses |
| `GET` | `/report` | Digest `?days=7` |
| `POST` | `/webhook/alertmanager` | Prometheus → AI → Slack |
| `POST` | `/webhook/github` | CI failure → AI → Slack |

---

## Security & Privacy

### Data flow

```
Your log → Rule engine (local, no network)
         → If no high-confidence match → Groq or Claude API (your key, your account)
```

Your logs are **never stored by nxs** — they live in memory for the duration of one CLI invocation and are discarded immediately after.

### What leaves your machine

| Data | Destination | When |
|---|---|---|
| Log text (up to 8KB tail) | Groq or Claude API | Only when AI is invoked — not with `--fast` |
| Analysis result | `~/.nxs/history.json` | Stored locally, never uploaded |
| Analysis result (cache) | `~/.nxs/cache.json` | Stored locally, 5-min TTL |
| Slack notification | Your Slack webhook/bot | Only when `--notify slack` is passed |

### Protections built in

- **`--redact`** — scrubs AWS keys, tokens, passwords, PEM blocks, bearer tokens, and 10+ other patterns with `[REDACTED]` before any API call
- **Passive warning** — nxs detects sensitive patterns in logs and warns you even without `--redact`, so you can decide before sending
- **`--fast`** — rule engine only, zero network calls, works fully offline
- **API keys** — stored in `~/.nxs/config.json` (user home, mode 600) or `.env` — never hardcoded or logged
- **REST API** (`nxs serve`) — secured via `NXS_API_KEY` header; unauthenticated requests are rejected
- **Path traversal guard** — `--output` flag restricts writes to the current working directory only
- **Dependency scanning** — Snyk monitors the package for known CVEs on every publish

---

## Global Commands

```bash
nxs                           # welcome screen with all tools
nxs info                      # full feature overview
nxs test crashloop            # run a built-in test scenario (offline)
nxs test --list               # list all 10 test scenarios
nxs history                   # all past analyses
nxs history --search "oom"    # search history
nxs report --days 7           # weekly digest
nxs report --notify slack     # post digest to Slack
nxs config --setup            # add AI key (interactive wizard)
nxs update                    # check for latest version
```

**Test scenarios** (run entirely offline via rule engine — great for demos):
`crashloop` · `oomkilled` · `imagepull` · `pending` · `evicted` · `rbac` · `ci-npm` · `ci-docker` · `ci-module` · `ci-timeout`

---

## Flags (all analyze / debug / diagnose commands)

```bash
--fast                  Rules engine only — no API call, works offline
--notify slack          Post result to Slack
--chat                  Enable follow-up Q&A after analysis (opt-in)
-j, --json              Raw JSON output (for scripting / CI)
-o, --output <file>     Save analysis as markdown
--fail-on <severity>    Exit 1 if severity matches (critical|warning)
--redact                Scrub secrets before sending to AI
-s, --stdin             Read from stdin
-i, --interactive       Paste log interactively
```

**Response cache:** Identical inputs within 5 minutes return instantly from `~/.nxs/cache.json` (up to 20 entries). Shown as `⚡ cached` in output — no API call, no token cost.

---

## AI Providers

| Provider | Key | Cost |
|---|---|---|
| **Groq** (recommended) | `GROQ_API_KEY` | Free — [console.groq.com](https://console.groq.com) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | $5 free credits — [console.anthropic.com](https://console.anthropic.com) |
| None | — | Demo mode — rule engine + smart mock responses |

Fallback chain: **Groq → Anthropic → rule engine → mock**

```bash
nxs config --setup              # interactive wizard
nxs config --set GROQ_API_KEY=gsk_...
nxs config --get                # show saved keys (masked)
```

Config: `~/.nxs/config.json` · History: `~/.nxs/history.json`

---

## Roadmap

- [ ] Rule engine coverage for Docker, Terraform, AWS errors
- [ ] `nxs ci analyze --watch` — poll for new failures continuously  
- [ ] Web dashboard — team insights and trend analysis
- [ ] Slack / GitHub native apps
- [ ] `nxs report --schedule` — automated daily/weekly digests

---

## License

MIT
