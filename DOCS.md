# nxs — Enterprise Product Plan

> From personal CLI tool to team-grade DevOps intelligence platform.
> Written from the perspective of Product, Architecture, Security, and Engineering.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Who It Serves — Personas](#2-who-it-serves--personas)
3. [The Problem We Solve — With Numbers](#3-the-problem-we-solve--with-numbers)
4. [Product Roadmap — 5 Phases](#4-product-roadmap--5-phases)
5. [Enterprise Architecture](#5-enterprise-architecture)
6. [Security Standards](#6-security-standards)
7. [API Design](#7-api-design)
8. [Data Model](#8-data-model)
9. [Integrations](#9-integrations)
10. [Developer Guide — How to Extend](#10-developer-guide--how-to-extend)
11. [Deployment & Operations](#11-deployment--operations)
12. [KPIs — How We Measure Success](#12-kpis--how-we-measure-success)
13. [Compliance & Enterprise Standards](#13-compliance--enterprise-standards)
14. [Pricing Model](#14-pricing-model)

---

## 1. Product Vision

### What is nxs

nxs is an AI-powered DevOps intelligence platform that reduces the time between
"something broke" and "it's fixed" — for every engineer on the team, not just seniors.

### Mission statement

> Give every engineer — from junior to SRE — the diagnostic power of a senior
> on-call engineer, available instantly, in the terminal and browser.

### The one-line pitch

**nxs turns cryptic DevOps errors into plain-English root cause + fix steps
in seconds, from the terminal, inside your existing workflow.**

### What it is NOT

- Not a monitoring tool (Datadog, Grafana do that)
- Not an alerting tool (PagerDuty, OpsGenie do that)
- Not a log aggregator (ELK, Loki do that)
- **nxs is the layer between alert and resolution — the diagnosis engine**

```
Alert fires                  → PagerDuty / OpsGenie
Engineer is paged            → existing
Engineer opens terminal      → existing
Engineer runs nxs            → THIS IS WHERE nxs LIVES
Engineer understands + fixes → MTTR drops
```

---

## 2. Who It Serves — Personas

### Persona 1 — Junior DevOps / Junior SRE

**Pain today:**
- Gets paged for issues they don't understand yet
- Spends 30–60 min Googling cryptic error messages
- Escalates to seniors who are also busy
- Afraid of making things worse

**How nxs helps:**
- Explains the error in plain English with context
- Gives step-by-step commands, not just theory
- Reduces escalation to seniors by 60–70%
- Builds their knowledge over time (they see the reasoning)

**Key features they use:**
```
nxs k8s debug --pod <name>
nxs k8s errors              ← reference card
nxs history                 ← learn from past incidents
```

---

### Persona 2 — Senior DevOps / SRE

**Pain today:**
- Constantly interrupted to explain errors to juniors
- On-call fatigue from complex multi-service incidents
- Manually runs 10+ kubectl/aws/gh commands to build context
- Context-switching between tools during incidents

**How nxs helps:**
- `nxs status` builds full context in one command
- AI handles the known patterns, senior focuses on novel problems
- `--output report.md` auto-generates incident reports
- `watch` mode catches errors before paging is needed

**Key features they use:**
```
nxs status
nxs k8s debug --pod <name> --output report.md
nxs devops watch /var/log/deploy.log --fail-on critical
nxs history                  ← pattern spotting across incidents
```

---

### Persona 3 — Platform / Infrastructure Engineer

**Pain today:**
- Manages multiple clusters across environments
- Needs to enforce CI quality gates
- Hard to get non-infra engineers to follow runbooks
- Too much toil in incident handoffs

**How nxs helps:**
- `--fail-on critical` creates automatic CI quality gates
- Runbook integration links AI fix to team's actual procedures
- Multi-cluster context switching
- Central history lets them audit what was run and when

**Key features they use:**
```
nxs k8s status -n production
nxs devops analyze build.log --fail-on critical --output artifacts/
nxs runbook add CrashLoopBackOff --url https://wiki/runbooks/k8s
```

---

### Persona 4 — Engineering Manager / Tech Lead

**Pain today:**
- No visibility into how long incidents take to resolve
- Hard to identify recurring failures
- Can't measure improvement from process changes
- Incident reports are manual and inconsistent

**How nxs helps:**
- MTTR dashboard — average time from first analysis to resolution
- Pattern reports — "CrashLoopBackOff appeared 12x this month in payment-service"
- Team history — who debugged what, when
- Auto-generated incident summaries

**Key features they use:**
```
nxs report mttr --last 30d
nxs report patterns --service payment-service
nxs report team --week
```

---

### Persona 5 — Security / Compliance Engineer

**Pain today:**
- Engineers paste logs with secrets into ChatGPT or Slack
- No audit trail of who ran what diagnostic commands
- Hard to prove compliance during audits
- Sensitive infra data leaving org boundaries

**How nxs helps:**
- `--redact` scrubs secrets before any data leaves the machine
- All API calls go through the nxs server (auditable)
- Audit log: user, timestamp, tool, input hash, output
- Data residency controls — EU/US region config
- No raw logs stored — only analysis results

---

### Persona 6 — Backend / Full-stack Developer (non-DevOps)

**Pain today:**
- Doesn't know Kubernetes or cloud infra
- Blocked when their service breaks in staging/production
- Has to wait for DevOps team to debug their pod
- Doesn't know what kubectl commands to even run

**How nxs helps:**
- `nxs k8s debug --pod my-service -n staging` — no K8s knowledge needed
- Plain-English output, not K8s jargon
- Chat follow-up: "what does OOMKilled mean for my Java app?"
- Gets unblocked without waiting for DevOps

---

## 3. The Problem We Solve — With Numbers

### Current state (without nxs)

```
Incident type           | Avg time to diagnose | Escalations/month
------------------------|---------------------|-------------------
K8s pod crash           | 25–45 min           | 12–20 per team
Docker build failure    | 15–30 min           | 8–15 per team
Terraform error         | 20–40 min           | 5–10 per team
AWS/GCP/Azure error     | 30–60 min           | 10–20 per team
CI/CD pipeline failure  | 10–20 min           | 20–40 per team
```

### With nxs (conservative estimate)

```
Incident type           | Time with nxs | Time saved | Escalations avoided
------------------------|---------------|------------|--------------------
K8s pod crash           | 2–5 min       | 20–40 min  | 70%
Docker build failure    | 1–3 min       | 12–27 min  | 60%
Terraform error         | 1–3 min       | 18–37 min  | 65%
AWS/GCP/Azure error     | 2–4 min       | 26–56 min  | 55%
CI/CD pipeline failure  | 1–2 min       | 9–18 min   | 70%
```

### Business impact — 10-engineer team

```
Avg salary DevOps engineer      $130,000/yr = $62.50/hr
Incidents per engineer per week 4–8
Hours lost per incident         0.5h (with nxs) vs 2.5h (without)
Hours saved per engineer/week   8–16h
Cost saved per engineer/week    $500–$1,000
Cost saved per 10-person team   $5,000–$10,000/week
Annual savings                  $250,000–$500,000
```

This is before counting:
- Reduced on-call fatigue and burnout
- Fewer production incidents (CI gate catches issues earlier)
- Faster onboarding of junior engineers

---

## 4. Product Roadmap — 5 Phases

### Phase 0 — Current State (Done)

```
✅ CLI tool: nxs devops / cloud / k8s / status
✅ AI analysis: Groq (free) → Anthropic → Mock fallback
✅ Live cluster status: nodes, pods, deployments, events
✅ Follow-up chat
✅ Local history (JSON)
✅ --output, --fail-on, --pod, --redact flags
✅ nxs devops watch (live log tailing)
✅ Web app (React + Vite) with all analysis tabs
```

---

### Phase 1 — Team Foundation (Month 1–2)

**Goal:** Turn a personal tool into a team tool.

```
Priority  Feature                         Who benefits
--------  ------------------------------  ---------------------------
P0        Central nxs API server          Everyone — shared state
P0        Shared team history             Managers, seniors
P0        Slack / Teams webhook           All engineers
P1        Auto Jira/Linear ticket         Platform engineers, managers
P1        Auth: GitHub/Google OAuth       Security, IT admins
P1        Org + team management           Admins
P2        Web dashboard (read-only)       Managers, non-CLI users
```

**Deliverables:**
- `nxs-server` Fastify app with PostgreSQL
- JWT-based session auth
- `POST /api/analyze` — proxies AI call, stores result
- `GET /api/history?team=X` — shared history
- Slack webhook: post analysis on `--slack` flag or watch trigger
- Jira integration: `--ticket jira` creates issue with full analysis
- Basic web dashboard: incident feed, severity breakdown

**Security baseline (Phase 1):**
- All traffic HTTPS (TLS 1.2+)
- JWT tokens, 8hr expiry, refresh tokens
- API keys encrypted at rest (AES-256)
- Input sanitization on all endpoints
- Rate limiting: 100 req/min per user

---

### Phase 2 — Production Grade (Month 3–4)

**Goal:** Safe enough to run against production clusters.

```
Priority  Feature                         Who benefits
--------  ------------------------------  ---------------------------
P0        RBAC (roles: viewer/analyst/admin)  Security, platform
P0        Full audit log                  Compliance, security
P0        Secrets vault integration       Security, platform
P0        Multi-cluster support           Platform engineers
P1        Multi-cloud account management  Cloud engineers
P1        --redact enforced at server     Security
P1        SSO / SAML (Okta, Azure AD)     Enterprise IT admins
P2        Webhook signing (HMAC)          Security
P2        IP allowlist                    Security
```

**Deliverables:**
- RBAC middleware: viewer / analyst / admin / org-admin
- Audit log table: user_id, action, resource, timestamp, input_hash, result_id
- Vault integration: HashiCorp Vault or AWS Secrets Manager for API key storage
- Multi-cluster config: `nxs config --add-cluster prod --kubeconfig ~/.kube/prod`
- SAML 2.0 SP support (Okta, Azure AD, Google Workspace)
- Redaction enforced server-side for specific orgs

---

### Phase 3 — Intelligence Layer (Month 5–6)

**Goal:** AI that knows YOUR infrastructure, not just generic patterns.

```
Priority  Feature                         Who benefits
--------  ------------------------------  ---------------------------
P0        Your infra context              All engineers
P0        Runbook integration             Platform, seniors
P0        Pattern detection across time   Managers, platform
P1        MTTR tracking + reports         Managers, leads
P1        Recurring failure alerts        SREs
P1        Custom AI system prompts        Platform, leads
P2        nxs learn (index your wiki)     All engineers
P2        Severity scoring history        Managers
```

**Deliverables:**
- Org context: `nxs context add "staging namespace is app-staging-*"`
  AI injects this into every prompt for that org
- Runbook KB: per error pattern → team wiki URL + summary
- Pattern engine: cron job that scans history, surfaces "X error 5+ times this week"
- MTTR report: `nxs report mttr --last 30d`
- Weekly email digest to managers: top errors, MTTR trend, team activity

---

### Phase 4 — Platform Integrations (Month 7–9)

**Goal:** nxs fits into existing enterprise toolchains.

```
Priority  Feature                         Who benefits
--------  ------------------------------  ---------------------------
P0        ArgoCD integration              Platform, K8s teams
P0        GitHub Actions native action    All dev teams
P1        Jenkins / GitLab CI plugin      Dev teams
P1        PagerDuty / OpsGenie webhook    SREs, on-call
P1        REST API (public)               Platform, automation
P2        Prometheus / Grafana alerts     SREs
P2        Terraform Cloud integration     Infra teams
P2        VS Code extension               Developers
```

**GitHub Actions example:**
```yaml
- name: Analyze build failure
  uses: nextsight/nxs-action@v1
  with:
    log: ${{ steps.build.outputs.log }}
    fail-on: critical
    slack-webhook: ${{ secrets.SLACK_WEBHOOK }}
    nxs-api-key: ${{ secrets.NXS_API_KEY }}
    create-issue: true
```

---

### Phase 5 — Enterprise & Scale (Month 10–12)

**Goal:** Ready for 500+ engineer orgs, compliance audits, SOC 2.

```
Priority  Feature                         Who benefits
--------  ------------------------------  ---------------------------
P0        SOC 2 Type II certification     Enterprise procurement
P0        GDPR / data residency           EU enterprise customers
P0        On-premise deployment (Helm)    Air-gapped / regulated orgs
P0        SLA: 99.9% uptime + support     Enterprise buyers
P1        White-labeling                  Resellers, large orgs
P1        AI model choice (private LLM)   Data-sensitive orgs
P1        Custom retention policies       Compliance
P2        Dedicated infrastructure        Large enterprise
P2        Custom contracts / DPA          Legal
```

---

## 5. Enterprise Architecture

### System architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                          │
│                                                          │
│   nxs CLI          Web Dashboard        CI/CD Systems   │
│   (engineers)      (managers)           (GH Actions)    │
└────────────┬────────────┬────────────────────┬──────────┘
             │            │                    │
             ▼            ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                  API GATEWAY LAYER                       │
│                                                          │
│   TLS termination  │  Rate limiting  │  Auth validation  │
│   WAF              │  Request ID     │  IP allowlist     │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                  nxs SERVER (Core)                       │
│                                                          │
│  /api/auth      /api/analyze    /api/history             │
│  /api/teams     /api/runbooks   /api/reports             │
│  /api/config    /api/clusters   /api/audit               │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Auth    │  │ Analyze  │  │ History  │  │ Audit  │  │
│  │ Service  │  │ Service  │  │ Service  │  │ Service│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
  PostgreSQL           Redis           Secrets Vault
  (history, teams,    (sessions,       (API keys,
   audit, runbooks)    rate limits,     kubeconfigs,
                       cache)           webhooks)
        │                                 │
        ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│               EXTERNAL INTEGRATIONS                      │
│                                                          │
│  Groq API    Anthropic    Slack    Jira    PagerDuty     │
│  Private LLM  Okta/SAML  Teams   Linear   OpsGenie      │
└─────────────────────────────────────────────────────────┘
```

### Request flow (analyze)

```
1.  Engineer runs: nxs k8s debug --pod crash-demo
2.  CLI fetches kubectl logs + describe (local, never leaves machine raw)
3.  CLI applies --redact (strips secrets before network call)
4.  CLI sends POST /api/analyze with JWT
5.  API gateway: validates JWT, rate check, assigns request-id
6.  Auth service: checks RBAC — analyst role required to analyze
7.  Analyze service:
    a. Loads org context (custom infra description)
    b. Loads runbook for detected error type
    c. Calls AI provider (Groq → Anthropic fallback)
    d. Parses + validates JSON response
    e. Stores result in PostgreSQL (input_hash, NOT raw log)
8.  Audit service: logs user_id, action, resource, timestamp, ip
9.  Webhook service: fires Slack if configured
10. Response returned to CLI → printed to terminal
```

---

## 6. Security Standards

### Authentication

```
Method          When used                    Standard
--------------  ---------------------------  --------
JWT (HS256)     CLI sessions                 RFC 7519
OAuth 2.0       GitHub, Google login         RFC 6749
SAML 2.0        Okta, Azure AD, ADFS         OASIS
API Keys        CI/CD systems, automation    Hashed SHA-256 in DB
Refresh tokens  Long-lived CLI sessions      Rotated every 30 days
```

### Authorization (RBAC)

```
Role         Permissions
-----------  -------------------------------------------------------
viewer       Read history, read reports — no analysis
analyst      Run analyses, read/write own history, use watch
engineer     All analyst + manage personal config + runbook lookup
admin        All engineer + manage team, integrations, clusters
org-admin    All admin + billing, SSO config, data retention policy
```

### Secrets handling

```
What                          How stored               How used
----------------------------  -----------------------  ----------------------
API keys (Groq, Anthropic)    Vault / encrypted col    Decrypted in-memory only
Kubeconfig credentials        Vault                    Never logged or stored
Slack/webhook URLs            Vault                    Never returned to client
User passwords                bcrypt (cost 12)         Never stored plain text
JWT signing secret            Vault                    Rotated quarterly
```

### Data security

```
In transit      TLS 1.2+ minimum, HSTS enforced, HTTP redirected to HTTPS
At rest         AES-256 for all sensitive DB columns
Log input       Input hash (SHA-256) stored, raw log text NEVER stored
AI calls        Truncated to 8000 chars, redacted if --redact or org policy
Retention       Default 90 days, configurable per org (30–365 days)
Right to delete GDPR: DELETE /api/me purges all user data and analyses
```

### Input security

```
All API inputs      Joi/Zod schema validation, strict types
Log text input      Max 50KB enforced server-side, binary content stripped
SQL                 Parameterized queries only — no string concatenation
Command injection   CLI uses execa with array args — no shell: true
XSS                 React (auto-escaped) + strict CSP headers
SSRF                Webhook URLs validated against domain allowlist
```

### Audit trail (required for SOC 2)

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "org_id": "uuid",
  "tool": "k8s",
  "action": "analyze",
  "input_hash": "sha256:abc...",
  "input_chars": 3205,
  "severity": "critical",
  "ai_provider": "groq",
  "ai_model": "llama-3.3-70b",
  "duration_ms": 1842,
  "timestamp": "2026-04-08T10:00:00Z",
  "ip_address": "1.2.3.4",
  "cluster_context": "prod-us-east",
  "redacted": true
}
```

---

## 7. API Design

### Base URL
```
https://api.nxs.dev/v1           (cloud-hosted)
https://nxs.your-company.com/v1  (self-hosted)
```

### Authentication
```
Authorization: Bearer <jwt-token>
X-API-Key: <api-key>             (for CI/CD systems)
```

### Core endpoints

```
POST   /auth/login               GitHub/Google OAuth callback
POST   /auth/token/refresh       Refresh JWT
DELETE /auth/logout              Revoke session

GET    /teams                    List teams in org
POST   /teams                    Create team
GET    /teams/:id/members        List members
POST   /teams/:id/invite         Invite member by email

POST   /analyze                  Run AI analysis
GET    /history                  List analyses (team-scoped)
GET    /history/:id              Get single analysis
DELETE /history/:id              Delete analysis

GET    /clusters                 List configured clusters
POST   /clusters                 Add cluster (name + kubeconfig)
DELETE /clusters/:id             Remove cluster

GET    /runbooks                 List runbooks for org
POST   /runbooks                 Add runbook entry
PATCH  /runbooks/:id             Update runbook
DELETE /runbooks/:id             Delete runbook

GET    /reports/mttr             MTTR over time period
GET    /reports/patterns         Recurring error patterns
GET    /reports/team             Team activity summary

GET    /audit                    Audit log (admin only)
GET    /audit/export             Export as CSV
```

### POST /analyze — request body

```json
{
  "tool": "k8s",
  "input": "<log text — max 50KB>",
  "input_hash": "sha256:...",
  "redacted": true,
  "cluster_context": "prod-us-east",
  "options": {
    "fail_on": "critical",
    "output_format": "json"
  }
}
```

### POST /analyze — response

```json
{
  "id": "ana_abc123",
  "tool": "kubernetes",
  "severity": "critical",
  "resource": "Pod",
  "namespace": "nextsight-demo",
  "summary": "...",
  "rootCause": "...",
  "fixSteps": "...",
  "commands": "...",
  "runbook": {
    "title": "CrashLoopBackOff playbook",
    "url": "https://wiki.internal/runbooks/k8s/crashloop"
  },
  "duration_ms": 1842,
  "ai_provider": "groq",
  "timestamp": "2026-04-08T10:00:00Z"
}
```

---

## 8. Data Model

```sql
-- Organizations
CREATE TABLE orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT DEFAULT 'free',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES orgs(id),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  role          TEXT DEFAULT 'analyst',
  sso_provider  TEXT,
  sso_id        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- Analyses (core history)
CREATE TABLE analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES orgs(id),
  user_id         UUID REFERENCES users(id),
  tool            TEXT NOT NULL,
  severity        TEXT,
  resource        TEXT,
  namespace       TEXT,
  summary         TEXT,
  root_cause      TEXT,
  fix_steps       TEXT,
  commands        TEXT,
  input_hash      TEXT,      -- SHA-256 only — raw log never stored
  input_chars     INTEGER,
  ai_provider     TEXT,
  ai_model        TEXT,
  duration_ms     INTEGER,
  cluster_context TEXT,
  redacted        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Runbooks
CREATE TABLE runbooks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES orgs(id),
  error_pattern TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  summary       TEXT,
  created_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log (append-only — never update or delete rows)
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID REFERENCES orgs(id),
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id UUID,
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Org AI context
CREATE TABLE org_context (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID REFERENCES orgs(id) UNIQUE,
  context    TEXT,  -- injected into every AI prompt for this org
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 9. Integrations

### Slack notification format

```
┌─────────────────────────────────────────┐
│ 🔴 CRITICAL — Kubernetes               │
│ Pod: crash-demo (nextsight-demo)        │
│                                         │
│ The container is failing to start due  │
│ to an invalid command in the spec.     │
│                                         │
│ Root cause: exec: " " not found in $PATH│
│                                         │
│ [View Full Analysis] [View Runbook]     │
│ Analyzed by: gauravtayade11 · just now │
└─────────────────────────────────────────┘
```

**When it fires:**
```
Analysis complete (--slack flag)
watch detects error → alert card
--fail-on triggered → red alert
Weekly digest → top errors + MTTR trend
```

### Jira auto-ticket

```
Title:    [CRITICAL] K8s: crash-demo — CrashLoopBackOff
Labels:   nxs, kubernetes, critical, auto-generated
Priority: Highest
Body:     Full analysis (summary + root cause + fix steps + commands)
          + cluster context + analysis ID + runbook link
```

### GitHub Actions

```yaml
- name: Analyze failure with nxs
  if: failure()
  uses: nextsight/nxs-action@v1
  with:
    tool: devops
    log-file: build.log
    fail-on: critical
    slack-webhook: ${{ secrets.NXS_SLACK_WEBHOOK }}
    nxs-api-key: ${{ secrets.NXS_API_KEY }}
    create-jira-issue: true
```

### PagerDuty

```
Trigger: nxs devops watch --alert pagerduty --severity critical
Action:  Creates PagerDuty incident
         Attaches nxs analysis as incident note
         Links runbook URL if available
```

---

## 10. Developer Guide — How to Extend

### Adding a new tool (e.g. nxs db for database errors)

```
1. Create cli/tools/db.js
   - Define SYSTEM_PROMPT
   - Define MOCK_RESPONSES
   - Export registerDb(program)

2. Register in cli/index.js
   import { registerDb } from './tools/db.js'
   registerDb(program)

3. Add to welcome screen tools list

Done — --output, --fail-on, --redact, --stdin all work
automatically via runAnalyze() in core/runner.js
```

### System prompt template

```javascript
const SYSTEM_PROMPT = `You are a [TOOL] expert. Analyze the provided log.
Return ONLY valid JSON with exactly this structure:
{
  "tool": "<detected tool type>",
  "severity": "<critical|warning|info>",
  "summary": "<1-2 sentence summary>",
  "rootCause": "<numbered list of causes>",
  "fixSteps": "<bulleted steps>",
  "commands": "<one command per line>"
}
Return ONLY valid JSON. No markdown fences.`;
```

### Project structure (current + target)

```
nxs/
├── cli/                       ← CLI tool (current — Phase 0)
│   ├── core/
│   │   ├── ai.js              ← AI provider logic
│   │   ├── config.js          ← Local config + history
│   │   ├── exec.js            ← Shell executor
│   │   ├── redact.js          ← Secrets scrubber
│   │   ├── runner.js          ← orchestration
│   │   └── ui.js              ← Terminal output
│   ├── tools/
│   │   ├── devops.js
│   │   ├── cloud.js
│   │   ├── k8s.js
│   │   └── status.js
│   └── index.js
│
├── server/                    ← Phase 1 — Central API server
│   ├── src/
│   │   ├── app.js             ← Fastify app
│   │   ├── auth/              ← JWT, OAuth, SAML
│   │   ├── routes/            ← API handlers
│   │   ├── services/          ← analyze, history, teams, reports
│   │   ├── db/                ← PostgreSQL + migrations
│   │   ├── integrations/      ← Slack, Jira, PagerDuty
│   │   └── middleware/        ← RBAC, rate limit, audit
│   ├── migrations/
│   └── Dockerfile
│
├── web/                       ← Web dashboard (Phase 1)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── api/
│   └── Dockerfile
│
├── packages/
│   ├── nxs-action/            ← Phase 4 — GitHub Actions
│   └── nxs-sdk/               ← Phase 4 — Node.js SDK
│
├── helm/                      ← Phase 5 — Self-hosted Helm chart
├── docker-compose.yml         ← Local dev stack
└── docs/                      ← Documentation site
```

---

## 11. Deployment & Operations

### Phase 1 — Cloud (fast, cheap start)

```
Component       Service           Cost/mo    Notes
--------------  ----------------  ---------  --------------------------
nxs server      Railway / Render  $20        Simple deploy
PostgreSQL      Supabase          $25        Managed, backups
Redis           Upstash           $0–10      Serverless
Secrets         Doppler           $0 free    Env var management
TLS             Cloudflare        $0         Auto-renew, DDoS
Logs            Betterstack       $0 free    Searchable logs
```

### Phase 5 — Enterprise self-hosted

```
Component       Deployment           Notes
--------------  -------------------  ---------------------------------
nxs server      Kubernetes (Helm)    HA, 2+ replicas, rolling deploys
PostgreSQL       AWS RDS / Cloud SQL  Managed, encrypted, automated backups
Redis           ElastiCache          Managed, cluster mode
Secrets         HashiCorp Vault      Enterprise key management
TLS             cert-manager         Auto-rotate via Let's Encrypt / internal CA
Auth            Okta / Azure AD      Customer's existing IdP via SAML
Logs            ELK / Splunk         Customer's existing stack
```

### Observability (nxs must be observable)

```
Metrics (Prometheus /metrics)
  analyze_requests_total       — by tool, severity, org
  analyze_duration_seconds     — histogram (p50/p95/p99)
  ai_provider_errors_total     — by provider
  active_watch_sessions        — gauge

Logs (structured JSON via Pino)
  Every request: method, path, status, duration, user_id, request_id
  Every AI call: provider, model, input_chars, duration, error

Traces (OpenTelemetry)
  Full trace: auth → validate → AI call → DB write → webhook

Alerts
  AI error rate > 5%           → PagerDuty P2
  API p99 latency > 3s         → PagerDuty P2
  DB connection failures        → PagerDuty P1
  Auth failures spike > 10/min → Security alert
```

---

## 12. KPIs — How We Measure Success

### Engineering impact

```
Metric                           Target (90 days)    How measured
-------------------------------  ------------------  ---------------------------
MTTR reduction                   -40%                avg resolve time in history
Senior escalation rate           -60%                Slack escalation count
Time: analysis → fix             < 5 min avg         timestamp delta
CI failures caught pre-prod      +30% caught earlier GH Actions data
Daily active usage               > 70% of team       auth log
```

### Product health

```
Metric                           Target              How measured
-------------------------------  ------------------  ---------------------------
Weekly active users / team       > 80%               server analytics
Analyses per engineer/week       5+                  server analytics
Slack integration adoption       > 60% of teams      integration config count
Runbooks added per team          > 10                runbook table count
Engineer NPS                     > 50                quarterly survey
```

### Business

```
Metric                  Target
----------------------  ---------------------------
Paid teams (Month 3)    5
Paid teams (Month 6)    25
Paid teams (Month 12)   100
Monthly churn           < 5%
ARR (Year 1)            $150,000–$300,000
```

---

## 13. Compliance & Enterprise Standards

### SOC 2 Type II (target: Month 10–12)

```
Trust Criteria        Controls
--------------------  -------------------------------------------------
Security (CC)         RBAC, MFA, encrypted secrets, audit log, WAF
Availability (A)      99.9% SLA, health checks, auto-restart, backups
Confidentiality (C)   Retention policy, right to delete, no raw logs
Processing Integrity  Input validation, AI response validation
Privacy (P)           GDPR, data residency, consent management
```

### GDPR compliance

```
Requirement           Implementation
--------------------  -------------------------------------------------------
Right to erasure      DELETE /api/me — removes all user data + analyses
Data minimization     Hash not raw text; analysis not full log input
Data residency        EU deployment option; org-level region config
Consent               Privacy policy; data never used to train AI models
DPA                   Standard contractual clauses available
Breach notification   < 72hr notification process, documented and tested
```

### What we NEVER store

```
Raw log text          — only SHA-256 hash stored
Plaintext passwords   — bcrypt only
API keys plaintext    — hashed in DB, encrypted in Vault
Kubeconfig raw        — encrypted in Vault, never logged
```

---

## 14. Pricing Model

```
Plan         Price              Who                  Limits
-----------  -----------------  -------------------  --------------------------
Free         $0/month           Individual engineers  500 analyses/month, local
Team         $29/user/month     Teams 5–50            Unlimited, shared history,
             min $99/month                           Slack, Jira, basic reports
Growth       $49/user/month     Teams 50–200          + SSO, RBAC, runbooks,
             min $499/month                          MTTR reports, multi-cluster
Enterprise   Custom             200+ / regulated      + SOC2, SAML, on-premise,
                                orgs                 SLA, dedicated support
```

### Free forever (drives adoption)

```
- Individual: always free, 500 analyses/month
- All CLI features including --output, --fail-on, watch
- Local history only
- Open source CLI (MIT license)
```

### Upgrade triggers

```
Free → Team         Need shared history, Slack, Jira, manager reports
Team → Growth       Need SSO, RBAC, audit log, multi-cluster
Growth → Enterprise Need SOC2, SAML, on-premise, SLA, compliance
```

---

## Summary

```
Dimension        Phase 0 (now)          Enterprise target
---------------  ---------------------  -----------------------------------
Data             Local JSON files       PostgreSQL, audit log, backups
Auth             None                   OAuth, SAML, MFA, RBAC
Security         --redact flag          Vault, AES-256, WAF, audit trail
Collaboration    Personal only          Team history, Slack, Jira, reports
AI quality       Generic prompts        Org context, runbooks, patterns
Reliability      CLI process            HA server, 99.9% SLA
Observability    Terminal output        Prometheus, traces, dashboards
Compliance       None                   SOC 2, GDPR, audit log
Deployment       npm link               Docker, Helm, Kubernetes
Pricing          Free                   Tiered SaaS + enterprise contracts
```

The CLI architecture (core/ + tools/) is already modular enough to wire into
a central server without rewriting it. Phase 1 puts a server in front of the
same AI logic — engineers barely notice, but teams get shared history and
Slack alerts immediately.
