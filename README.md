# ⚡ nxs — AI-Powered DevOps Intelligence CLI

[![npm](https://img.shields.io/npm/v/@nextsight/nxs-cli)](https://www.npmjs.com/package/@nextsight/nxs-cli)
[![npm downloads](https://img.shields.io/npm/dm/@nextsight/nxs-cli)](https://www.npmjs.com/package/@nextsight/nxs-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/gauravtayade11/nxs?style=social)](https://github.com/gauravtayade11/nxs)
[![Snyk](https://img.shields.io/badge/security-snyk-4C4A73?logo=snyk)](https://snyk.io)

> Paste any error log — Kubernetes, Docker, CI/CD, AWS, GCP, Azure, Terraform —
> and instantly get root cause + fix commands. Auto-notify Slack. Integrate with Prometheus Alertmanager.

```bash
npm install -g @nextsight/nxs-cli        # v2.1.3
nxs config --setup
kubectl logs my-pod --previous | nxs k8s debug --stdin
```

---

## What it does

You pipe or paste a broken log. nxs gives you:

- **What** broke (plain English summary)
- **Why** it broke (root cause, numbered)
- **How** to fix it (step-by-step)
- **Which commands** to run (copy-paste ready)
- **Slack notification** — automatically, with AI diagnosis attached

Works with **Groq** (free), **Anthropic Claude**, or **no key at all** (smart mock mode).

---

## Install

```bash
npm install -g @nextsight/nxs-cli
```

**Requirements:** Node.js 18+

Optional CLIs (for live cluster features) — nxs will warn if missing:
- `kubectl` — for `nxs k8s`, `nxs predict`, `nxs autopilot`, `nxs rbac`, `nxs trace`, `nxs status`
- `helm` — for `nxs status --only helm`
- `gh` — for `nxs ci analyze --run <id>`, `nxs devops pipelines`
- `trivy` — for `nxs sec scan --image` and `nxs sec cluster`
- `git` — for `nxs blame` (commit timeline)

---

## Quick start

```bash
# 1. Add an AI key (free)
nxs config --setup        # interactive wizard
                          # Groq free key: console.groq.com
                          # Or skip — demo mode works without any key

# 2. Analyze your first error
kubectl logs my-pod --previous | nxs k8s debug --stdin
docker build . 2>&1       | nxs devops analyze --stdin
terraform apply 2>&1      | nxs devops analyze --stdin

# 3. Live cluster view
nxs status
nxs k8s pods --watch
```

---

## Tools

### `nxs devops` — CI/CD · Docker · Terraform

```bash
nxs devops analyze <file/--stdin>     # root cause + fix
nxs devops analyze --notify slack     # analyze + post to Slack
nxs devops pipelines                  # GitHub Actions run status
nxs devops pipelines --watch          # live refresh
nxs devops history
```

Detects: Docker build failures, npm errors, Terraform misconfigs, pipeline failures

---

### `nxs k8s` — Kubernetes

```bash
nxs k8s debug <file/--stdin>
nxs k8s debug --pod <name> -n <ns>          # auto-fetch logs + describe
nxs k8s debug --deployment <name> -n <ns>   # fetch all pods in deployment
nxs k8s status [-n namespace]               # nodes · pods · deployments
nxs k8s pods [--watch]                      # live pod counts by status
nxs k8s errors                              # quick reference card
nxs k8s history
```

Detects: CrashLoopBackOff, OOMKilled, ImagePullBackOff, Pending (scheduling), RBAC errors

---

### `nxs rbac` — Kubernetes RBAC Scanner

```bash
nxs rbac scan                         # scan current cluster
nxs rbac scan -n <namespace>          # specific namespace
nxs rbac scan --fail-on critical      # exit 1 if critical findings
nxs rbac scan --json                  # raw JSON output
```

Checks: cluster-admin wildcard bindings, anonymous access, wildcard verbs,
default SA over-permissions, cross-namespace escalation

---

### `nxs ci` — CI/CD Pipeline Failure Analyzer

```bash
nxs ci analyze <file/--stdin>
nxs ci analyze --run <github-run-id>  # auto-fetch via gh CLI
nxs ci analyze --stdin --notify slack # analyze + Slack notification
nxs ci analyze --fail-on critical     # gate your pipeline
nxs ci history
```

Detects: GitHub Actions, GitLab CI, Jenkins, CircleCI failures

**Auto-notify on pipeline failure** — add to `.github/workflows/ci.yml`:

```yaml
notify-failure:
  needs: [build, test]
  if: failure()
  steps:
    - uses: actions/checkout@v4
    - run: npm install
    - run: |
        {
          echo "Workflow: ${{ github.workflow }}"
          echo "Branch: ${{ github.ref_name }}"
          echo "Run URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          gh run view ${{ github.run_id }} 2>&1 || true
        } | node cli/index.js ci analyze --stdin --notify slack --no-chat --json || true
      env:
        GH_TOKEN: ${{ github.token }}
        GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

### `nxs sec` — Security Scanning

```bash
nxs sec scan <file/--stdin>           # analyze Trivy/Grype/Snyk output
nxs sec scan --image <name>           # scan Docker image directly
nxs sec scan --pod <name>             # auto-detect pod image + scan
nxs sec cluster [-n namespace]        # scan ALL images in cluster
nxs sec cluster --detailed            # full CVE list per image
nxs sec cluster --severity HIGH       # filter severity
nxs sec history
```

---

### `nxs net` — Network & Connectivity

```bash
nxs net diagnose <file/--stdin>
nxs net diagnose --check <host>       # live: ping + DNS + TCP
nxs net diagnose --cert <host>        # TLS certificate expiry check
nxs net errors                        # reference card
```

---

### `nxs db` — Database Errors

```bash
nxs db diagnose <file/--stdin>
nxs db history
```

Detects: PostgreSQL, MySQL, MongoDB, Redis connection/query errors

---

### `nxs cloud` — AWS · GCP · Azure

```bash
nxs cloud diagnose <file/--stdin>
nxs cloud providers                   # supported services list
nxs cloud history
```

Detects: IAM permission errors, missing roles, API not enabled, billing issues

---

### `nxs explain` — Explain Any DevOps Term

```bash
nxs explain CrashLoopBackOff
nxs explain "OOMKilled"
nxs explain "Terraform state lock"
nxs explain RBAC
```

---

### `nxs watch` — Live Log Monitor

```bash
nxs watch /var/log/app.log            # tail a file, AI on every error
nxs watch "kubectl logs -f my-pod"   # stream a command, AI on errors
nxs watch app.log --notify slack      # post to Slack when errors detected
nxs watch app.log --cooldown 120      # min seconds between AI calls
```

---

### `nxs predict` — Failure Prediction

```bash
nxs predict                           # scan all namespaces
nxs predict -n production             # specific namespace
nxs predict --threshold 80            # warn when usage exceeds 80% of limit
nxs predict --ai                      # AI deep analysis
```

Detects at-risk pods before they fail: high memory usage, high restart counts,
OOMKilled state, ImagePullBackOff, node pressure, unbound PVCs.

---

### `nxs autopilot` — Self-Healing Assistant

```bash
nxs autopilot -n production           # watch + prompt before fixing
nxs autopilot -n staging --auto       # auto-apply safe fixes
nxs autopilot --dry-run               # show what would be fixed
nxs autopilot --once                  # run once instead of watching
```

Watches for unhealthy pods, proposes fixes, and applies them (with confirmation or automatically).
Safe auto-fixes: restart crashed pods, bump memory on OOMKill.

---

### `nxs blame` — Incident Root Cause Correlator

```bash
nxs blame                             # last 1 hour
nxs blame --since 2h -n production   # specific window + namespace
nxs blame --repo /path/to/app        # point at your app git repo
nxs blame --no-git                   # k8s events only
```

Correlates git commits + kubectl events + deploy history into a single timeline,
then uses AI to identify the likely root cause of a production incident.

---

### `nxs noise` — Alert Fatigue Analyzer

```bash
nxs noise                                        # analyze nxs history
nxs noise --alertmanager http://localhost:9093   # query live Alertmanager
nxs noise --days 30 --threshold 60              # tune sensitivity
nxs noise --ai                                   # AI suppression recommendations
```

Scores each alert by fire frequency vs actionability.
Outputs noise alerts with suppression commands and actionable alerts to keep.

---

### `nxs incident` — Full Incident Commander

```bash
nxs incident start --title "API down" --severity critical
nxs incident update <id> --note "Root cause: DB connection pool exhausted"
nxs incident close  <id> --resolution "Increased pool size to 50"
nxs incident list
nxs incident view  <id>
nxs incident postmortem <id>          # AI-generated postmortem
nxs incident postmortem <id> --output postmortem.md
```

Full incident lifecycle from the terminal. Slack notifications at every stage.
AI-generated postmortem with root cause, timeline, and prevention action items.

---

### `nxs trace` — HTTP Request Tracer

```bash
nxs trace http://localhost:8080/api/users -n trace-demo
nxs trace http://localhost:8080/api/users --count 5 --ai
nxs trace http://localhost:8080/api/users --jaeger http://localhost:16686
nxs trace --jaeger http://localhost:16686 --live           # real-time waterfall
nxs trace --jaeger http://localhost:16686 --live --ai      # AI on slow spans
nxs trace --jaeger http://localhost:16686 --live --slow-ms 100
```

Hits a URL N times, measures timing per hop (frontend → backend → DB), fetches pod logs,
shows CPU/memory at the time of the request.

`--live` mode polls Jaeger every 2s and renders new traces as a waterfall as they arrive:

```
[14:02:31]  GET /api/users  200  181ms
backend:http.request /api/us   181ms  ████████████  ← SLOW
└─ backend:db.query.users      179ms  ████████████  ← SLOW
      sql: SELECT * FROM users
```

**Requirements for `--live`:** deploy Jaeger and instrument your app with OpenTelemetry.
Demo manifests: `kubectl apply -f k8s/trace-demo.yaml && kubectl apply -f k8s/jaeger.yaml`

---

### `nxs status` — Live Dashboard

```bash
nxs status                            # full: cluster + pipelines + helm
nxs status --only k8s                 # cluster only
nxs status --only pipelines           # GitHub Actions only
nxs status --only helm                # Helm releases only
nxs status -n <namespace>
```

---

### `nxs serve` — REST API Server

Run nxs as a server for team and CI/CD integration.

```bash
NXS_API_KEY=secret \
SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
nxs serve --port 4000
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/info` | Version, tools, history count |
| POST | `/analyze` | `{ tool, log }` → analysis JSON |
| GET | `/history` | Past analyses `?tool=k8s&limit=20` |
| GET | `/report` | Markdown digest `?days=7` |
| POST | `/webhook/alertmanager` | Prometheus Alertmanager → analyze → Slack |
| POST | `/webhook/github` | GitHub Actions failure → analyze → Slack |

**Auth:** Set `NXS_API_KEY` — all endpoints except `/health` and `/webhook/*` require `X-Api-Key` header.

**Prometheus Alertmanager integration** (`alertmanager.yml`):

```yaml
receivers:
  - name: nxs
    webhook_configs:
      - url: http://<your-nxs-server>:4000/webhook/alertmanager
        send_resolved: true
route:
  receiver: nxs
```

Every Prometheus alert automatically gets AI-diagnosed and posted to Slack.

---

## Flags (all analyze/debug/diagnose commands)

```bash
--notify slack          Post result to Slack (requires SLACK_WEBHOOK_URL)
--no-chat               Skip follow-up chat
-j, --json              Raw JSON output (for scripting/CI)
-o, --output <file>     Save analysis as a markdown report
--fail-on <severity>    Exit 1 if severity matches (critical|warning)
--redact                Scrub secrets before sending to AI
-s, --stdin             Read from stdin
-i, --interactive       Paste log interactively
```

---

## Real-world one-liners

```bash
# Debug a crashing pod
kubectl logs my-pod --previous | nxs k8s debug --stdin

# Debug and notify Slack in one command
kubectl logs my-pod --previous | nxs k8s debug --stdin --notify slack

# Gate a CI pipeline on analysis severity
nxs devops analyze build.log --no-chat --fail-on critical

# Scan all images in production namespace
nxs sec cluster -n production --detailed

# Scan Kubernetes RBAC for misconfigs
nxs rbac scan --fail-on critical

# Analyze a GitHub Actions failure
nxs ci analyze --run 12345

# Watch a live deploy, AI alert on first error
nxs watch "kubectl logs -f deploy/my-app" --notify slack

# Save analysis as a report for a ticket
kubectl describe pod my-pod | nxs k8s debug --stdin --output report.md

# Explain any error you see
nxs explain OOMKilled

# Full infra snapshot
nxs status
```

---

## AI providers

| Provider | Key | Cost |
|---|---|---|
| **Groq** (recommended) | `GROQ_API_KEY` | Free — [console.groq.com](https://console.groq.com) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | $5 free credits — [console.anthropic.com](https://console.anthropic.com) |
| None | — | Demo mode — smart mock responses, no key needed |

Fallback chain: **Groq → Anthropic → smart mock** (rate limit / network errors auto-fallback).

```bash
nxs config --setup           # interactive wizard
nxs config --set GROQ_API_KEY=gsk_...
nxs config --get             # show saved keys (masked)
```

Keys saved to `~/.nxs/config.json`. History saved to `~/.nxs/history.json` (last 50 per tool).

---

## Global commands

```bash
nxs                          # welcome screen
nxs info                     # full feature overview
nxs history                  # all past analyses
nxs history --search "oom"   # search history
nxs history --clear
nxs report --days 7          # weekly digest
nxs report --notify slack    # post digest to Slack
nxs config --setup           # add AI key
nxs update                   # check for latest version
```

---

## Environment variables

```bash
GROQ_API_KEY          # Groq API key
ANTHROPIC_API_KEY     # Anthropic API key
SLACK_WEBHOOK_URL     # Slack incoming webhook URL
NXS_API_KEY           # API key for nxs serve auth
```

---

## License

MIT
