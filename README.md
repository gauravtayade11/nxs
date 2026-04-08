# ⚡ NextSight DevOps — MVP

> AI-powered DevOps & Cloud debugger — Web App + CLI

---

## What is this?

A tool that takes your raw error logs (Kubernetes, Docker, CI/CD, AWS, GCP, Azure, Terraform) and instantly tells you:
- What broke
- Why it broke
- How to fix it
- Which commands to run

Two interfaces — a web app you open in a browser, and a CLI you pipe logs into directly from the terminal.

---

## Who is it for?

| Role | How they use it |
|---|---|
| DevOps / Platform Engineer | Paste pipeline failures, get root cause + fix commands |
| Cloud Engineer | Diagnose AWS AccessDenied, GCP IAM errors, Azure RBAC issues |
| Backend Dev | Debug Kubernetes CrashLoopBackOff or ImagePullBackOff quickly |
| SRE / On-call | Live cluster dashboard + one-liner to analyze failing pods |

---

## Web App

**Start:** `npm run dev` → http://localhost:5173

### Features

| Feature | What it does |
|---|---|
| **Paste or upload log** | Textarea + file upload (.log, .txt) |
| **Example log buttons** | One-click: Kubernetes / Docker / Terraform / CI/CD sample errors |
| **Clear button** | ✕ inside textarea, clears in one click |
| **AI analysis** | Detects tool type, returns structured result |
| **Summary tab** | 1-2 sentence plain-English error description |
| **Root Cause tab** | Detailed numbered breakdown of why it failed |
| **Fix Steps tab** | Step-by-step remediation actions |
| **Commands tab** | Copy-paste shell commands with one-click copy |
| **Ask AI tab** | Follow-up chat — ask anything about the error |
| **Export** | Download full analysis as `.md` file |
| **History sidebar** | Last 5 analyses, click to reload, clear all |
| **Mobile support** | Sidebar becomes a slide-in drawer on small screens |
| **Loading state** | Spinner while AI is working, error banner on failure |

### AI Providers (web)

| Provider | Key | Cost |
|---|---|---|
| Groq | `VITE_GROQ_API_KEY` | Free |
| Anthropic Claude | `VITE_ANTHROPIC_API_KEY` | $5 free credits |
| None | — | Demo/mock mode |

---

## CLI

**Install:** `npm link` → use `nxs` from anywhere

### Tools

#### `nxs devops` — CI/CD · Docker · Terraform
```bash
nxs devops analyze error.log           # analyze a file
nxs devops analyze --stdin             # pipe from any command
nxs devops analyze --interactive       # paste manually
nxs devops pipelines                   # GitHub Actions status
nxs devops pipelines --watch           # auto-refresh every 30s
nxs devops examples                    # sample error logs to test
```

**Detects:** Docker build failures, npm install errors, Terraform misconfigs, GitHub Actions / Jenkins / GitLab CI failures

---

#### `nxs cloud` — AWS · GCP · Azure
```bash
nxs cloud diagnose error.log
aws s3 ls 2>&1 | nxs cloud diagnose --stdin
nxs cloud providers                    # list supported services
```

**Detects:** IAM permission errors, missing roles, API not enabled, RBAC issues, resource misconfigs

---

#### `nxs k8s` — Kubernetes
```bash
nxs k8s debug pod.log
kubectl logs my-pod --previous | nxs k8s debug --stdin
nxs k8s status                         # nodes + pods + deployments
nxs k8s status -n production           # filter by namespace
nxs k8s pods                           # pod counts by status
nxs k8s pods --watch                   # live refresh every 5s
nxs k8s errors                         # quick reference card
```

**Detects:** ImagePullBackOff, CrashLoopBackOff, OOMKilled, Pending (scheduling), RBAC errors

---

#### `nxs status` — Live Dashboard
```bash
nxs status                             # full dashboard
nxs status --only k8s                  # cluster only
nxs status --only pipelines            # pipelines only
nxs status --only helm                 # helm releases only
nxs status -n production               # specific namespace
```

**Shows:**
- Nodes (Ready / NotReady count)
- Pods (total, grouped by status, unhealthy highlighted)
- Deployments (healthy vs degraded)
- Recent Kubernetes warning events
- GitHub Actions runs (active, recent, failed)
- Helm releases (deployed / failed)

---

### Global commands
```bash
nxs history                            # all past analyses
nxs config --setup                     # interactive API key wizard
nxs config --set GROQ_API_KEY=xxx      # set a key directly
nxs config --get                       # show saved keys (masked)
```

### Output flags (all analyze/diagnose/debug commands)
```bash
--no-chat          skip follow-up Q&A after analysis
--json / -j        output raw JSON (for scripting)
-n <namespace>     filter Kubernetes by namespace
```

### AI Providers (CLI)

| Provider | Key (in .env or `nxs config --set`) | Cost |
|---|---|---|
| Groq | `GROQ_API_KEY` | Free |
| Anthropic Claude | `ANTHROPIC_API_KEY` | $5 free credits |
| None | — | Demo/mock mode |

Keys are saved to `~/.nxs/config.json` — work from any directory.
History saved to `~/.nxs/history.json` — last 50 entries.

---

## Real-world one-liners

```bash
# Debug a crashing pod instantly
kubectl logs my-pod --previous | nxs k8s debug --stdin

# Debug a failed Docker build
docker build . 2>&1 | nxs devops analyze --stdin

# Debug a failed GitHub Actions run
gh run view <run-id> --log-failed | nxs devops analyze --stdin

# Debug an AWS error
aws s3 cp file.txt s3://my-bucket/ 2>&1 | nxs cloud diagnose --stdin

# Debug Terraform apply failure
terraform apply 2>&1 | nxs devops analyze --stdin

# Watch pods live
nxs k8s pods --watch

# Full infrastructure snapshot
nxs status
```

---

## Project structure

```
├── src/                     Web app (React + Vite)
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── LogInput.jsx       textarea, file upload, example buttons
│   │   ├── AnalysisOutput.jsx tabs: summary/cause/fix/commands/chat
│   │   └── HistorySidebar.jsx last 5 analyses
│   └── utils/
│       ├── ai.js              Groq + Anthropic + mock fallback
│       └── exampleLogs.js     sample error logs
│
└── cli/                     CLI (Node.js)
    ├── index.js               nxs entry point + router
    ├── core/
    │   ├── ai.js              shared AI calls
    │   ├── config.js          ~/.nxs/config.json + history.json
    │   ├── exec.js            shell command runner
    │   ├── runner.js          shared analyze + chat loop
    │   └── ui.js              banner, colors, printResult
    └── tools/
        ├── devops.js          nxs devops
        ├── cloud.js           nxs cloud
        ├── k8s.js             nxs k8s
        └── status.js          nxs status + k8s pods/status + devops pipelines
```

---

## What's not built yet

| Feature | Value |
|---|---|
| `nxs devops watch <file>` | Tail a live log, auto-analyze on error |
| Slack / webhook alert | Post analysis result to Slack after CI failure |
| `nxs devops scan <dir>` | Scan a folder of `.log` files, summarize all |
| `--output report.md` | Save result to file directly |
| Severity filter | `nxs history --severity critical` |
| `--fail-on critical` | Exit code 1 in CI when severity is critical |
| Security tool (`nxs sec`) | Trivy/Grype scan output analysis |
| Network tool (`nxs net`) | DNS, connectivity, cert expiry diagnosis |
