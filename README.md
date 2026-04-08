# ⚡ nxs — DevOps Intelligence CLI

> AI-powered debugger for Kubernetes, Docker, CI/CD, AWS, GCP, Azure, and Terraform.
> Get root cause + fix steps in seconds — right in your terminal.

```bash
npm install -g nxs-cli
nxs
```

---

## What it does

You paste or pipe a broken log. nxs tells you:
- **What** broke (in plain English)
- **Why** it broke (root cause, numbered)
- **How** to fix it (step-by-step)
- **Which commands** to run (copy-paste ready)

Then you can ask follow-up questions in a chat.

---

## Install

**Requirements:** Node.js 18+

```bash
npm install -g nxs-cli
```

Optional (for live cluster features):
- `kubectl` — for `nxs k8s` and `nxs status`
- `helm` — for `nxs status --only helm`
- `gh` (GitHub CLI) — for `nxs devops pipelines`

---

## Quick start

### 1. Set up your AI key (free)

```bash
nxs config --setup
```

Get a free Groq key at [console.groq.com](https://console.groq.com) — no credit card needed.
Or use Anthropic (`ANTHROPIC_API_KEY`). Or skip — it works in demo mode without any key.

### 2. Analyze your first error

```bash
# From a file
nxs devops analyze build.log

# Pipe directly from any command
kubectl logs my-pod --previous | nxs k8s debug --stdin
docker build . 2>&1 | nxs devops analyze --stdin
terraform apply 2>&1 | nxs devops analyze --stdin
aws s3 ls 2>&1 | nxs cloud diagnose --stdin

# Debug a pod by name (no piping needed)
nxs k8s debug --pod my-pod -n my-namespace

# Try an example without a real error
nxs devops examples
```

### 3. See your cluster live

```bash
nxs status
nxs k8s pods --watch
```

---

## Tools

### `nxs devops` — CI/CD · Docker · Terraform

```bash
nxs devops analyze <file>          # analyze a log file
nxs devops analyze --stdin         # pipe from any command
nxs devops analyze --interactive   # paste manually
nxs devops watch <file>            # tail live log, auto-analyze on errors
nxs devops pipelines               # GitHub Actions run status
nxs devops pipelines --watch       # live refresh every 30s
nxs devops examples                # sample logs to test with
nxs devops history                 # past analyses
```

**Detects:** Docker build failures, npm errors, Terraform misconfigs,
GitHub Actions / Jenkins / GitLab CI failures

---

### `nxs cloud` — AWS · GCP · Azure

```bash
nxs cloud diagnose <file>
nxs cloud diagnose --stdin
nxs cloud providers                # list supported services
nxs cloud history
```

**Detects:** IAM permission errors, missing roles, API not enabled,
RBAC misconfigs, resource errors

---

### `nxs k8s` — Kubernetes

```bash
nxs k8s debug <file>
nxs k8s debug --stdin
nxs k8s debug --pod <name> -n <namespace>   # auto-fetch logs + describe
nxs k8s status                     # nodes, pods, deployments
nxs k8s status -n <namespace>      # filter by namespace
nxs k8s pods                       # pod count by status
nxs k8s pods --watch               # live refresh every 5s
nxs k8s errors                     # quick reference card
nxs k8s history
```

**Detects:** ImagePullBackOff, CrashLoopBackOff, OOMKilled,
Pending (scheduling), RBAC errors

---

### `nxs status` — Live Dashboard

```bash
nxs status                         # full dashboard
nxs status --only k8s              # cluster only
nxs status --only pipelines        # GitHub Actions only
nxs status --only helm             # Helm releases only
nxs status -n <namespace>          # filter namespace
```

**Shows:** Node health, pod counts by status, deployment health,
recent warning events, GitHub Actions runs, Helm release status

---

## Flags (work on all analyze/debug/diagnose commands)

```bash
--no-chat               Skip follow-up chat after analysis
-j, --json              Raw JSON output (for scripting/CI)
-o, --output <file>     Save full analysis as a markdown report
--fail-on <severity>    Exit code 1 if severity matches (critical|warning)
--redact                Scrub secrets/tokens before sending to AI
-s, --stdin             Read from stdin
-i, --interactive       Paste log interactively
```

---

## Real-world one-liners

```bash
# Debug any pod instantly — no piping needed
nxs k8s debug --pod crash-demo -n production

# Gate a CI pipeline — fail the build if analysis is critical
nxs devops analyze build.log --no-chat --fail-on critical

# Save analysis as a report for your ticket
kubectl describe pod my-pod | nxs k8s debug --stdin --output report.md

# Watch a live deploy log, get alerted on first error
nxs devops watch /var/log/deploy.log --no-chat

# Debug AWS error without leaking credentials
aws s3 ls 2>&1 | nxs cloud diagnose --stdin --redact

# Debug a failed GitHub Actions run
gh run view <run-id> --log-failed | nxs devops analyze --stdin

# Live pod dashboard
nxs k8s pods --watch

# Full infra snapshot
nxs status
```

---

## Global commands

```bash
nxs                        # welcome screen + tool list
nxs info                   # full feature overview
nxs config --setup         # interactive API key wizard
nxs config --set KEY=value # set a key directly
nxs config --get           # show saved keys (masked)
nxs history                # all past analyses (all tools)
nxs history -n 5           # limit entries
nxs history --clear        # clear all history
nxs <tool> --help          # help for any tool
```

---

## AI providers

| Provider | Key | Cost | How to get |
|---|---|---|---|
| **Groq** (recommended) | `GROQ_API_KEY` | Free | [console.groq.com](https://console.groq.com) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | $5 free credits | [console.anthropic.com](https://console.anthropic.com) |
| None | — | Free | Demo/mock mode — works without any key |

Set via wizard:
```bash
nxs config --setup
```

Or set directly:
```bash
nxs config --set GROQ_API_KEY=gsk_...
```

Keys saved to `~/.nxs/config.json` — work from any directory.
History saved to `~/.nxs/history.json` — last 50 entries per tool.

---

## Web app

A browser interface is also included for teams who prefer a UI.

```bash
git clone https://github.com/gauravtayade11/nxs
cd nxs
npm install
cp .env.example .env       # add your API keys
npm run dev                # http://localhost:5173
```

Web app features: paste or upload logs, tabbed analysis output (Summary / Root Cause / Fix Steps / Commands / Ask AI), export as markdown, history sidebar, mobile support.

---

## Project structure

```
cli/
  index.js              entry point + command routing
  core/
    ai.js               AI provider logic (Groq → Anthropic → Mock)
    config.js           ~/.nxs/ config + history
    exec.js             shell command runner (kubectl, helm, gh)
    redact.js           secrets scrubber
    runner.js           analyze / watch / history orchestration
    ui.js               terminal output formatting
  tools/
    devops.js           nxs devops
    cloud.js            nxs cloud
    k8s.js              nxs k8s
    status.js           nxs status + live dashboards

src/                    web app (React + Vite)
  components/
    LogInput.jsx        textarea, file upload, example buttons
    AnalysisOutput.jsx  tabs: summary / root cause / fix / commands / chat
    HistorySidebar.jsx  last 5 analyses
    Header.jsx
  utils/
    ai.js               Groq + Anthropic + mock (browser)
    exampleLogs.js      sample logs
```

---

## License

MIT — free to use, modify, and distribute.
