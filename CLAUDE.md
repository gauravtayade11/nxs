# nxs Development Guide

AI-powered DevOps intelligence CLI — debug Kubernetes, CI/CD, cloud errors instantly from the terminal.

## Quick start

```bash
npm install
node cli/index.js --help
npm test
npm run lint
```

## Codebase structure

```
cli/
├── index.js           # Entry point — registers all commands, startup version check
├── core/
│   ├── ai.js          # AI provider abstraction (Anthropic claude-sonnet-4-5 / Groq llama-3.3-70b)
│   ├── runner.js      # Shared runAnalyze() loop — input, redact, AI, chat, Slack
│   ├── rules.js       # Offline rules engine — pattern match before AI call
│   ├── redact.js      # Scrub secrets/tokens before sending to AI
│   ├── config.js      # Persist config + history to ~/.nxs/
│   └── ui.js          # Banners, spinners, printResult, promptSecret
└── tools/             # One file per nxs subcommand
    ├── k8s.js         # nxs k8s debug/describe/events
    ├── devops.js      # nxs devops pipeline/docker/terraform
    ├── sec.js         # nxs sec scan (Trivy image/pod scanning)
    ├── predict.js     # nxs predict (failure prediction from metrics)
    ├── incident.js    # nxs incident declare/update/resolve
    ├── autopilot.js   # nxs autopilot (self-healing loop)
    ├── watch.js       # nxs watch (live log error detection)
    ├── serve.js       # nxs serve (local AI proxy server)
    └── ...            # cloud, db, net, ci, explain, rbac, status, noise, blame
```

## Key patterns

### Adding a new command
1. Create `cli/tools/mytool.js` — export `registerMytool(program)`
2. Import and register in `cli/index.js`
3. Use `runAnalyze(toolName, systemPrompt, mockFn, file, opts)` from `core/runner.js`
4. Provide a `mockFn` that returns a valid result object for tests

### runAnalyze flow
Input (stdin / file / --interactive / auto-fetch) → `warnIfSensitive()` → optional `redact()` → rules engine → AI → `printResult()` → optional chat loop → optional Slack notify

### AI providers
- Primary: Anthropic `claude-sonnet-4-5` via `ANTHROPIC_API_KEY`
- Fallback: Groq `llama-3.3-70b-versatile` via `NXS_GROQ_API_KEY`
- Response cache: file-backed at `~/.nxs/cache.json`, disabled in `NODE_ENV=test`

### Result shape
All AI responses must return this JSON shape:
```json
{
  "issue": "short title",
  "severity": "critical | warning | info",
  "confidence": 0-100,
  "rootCause": "explanation",
  "fixSteps": "numbered steps",
  "commands": "shell commands to run",
  "summary": "one-liner"
}
```

## Tests

```bash
npm test                    # runs all tests (NODE_ENV=test, no API calls)
npm run test:coverage       # with lcov coverage report
npm run lint                # eslint flat config
```

Tests use mock functions — no API key needed. Cache is disabled in `NODE_ENV=test`.

## Config files

| File | Purpose |
|---|---|
| `~/.nxs/config.json` | API keys, provider preference, Slack webhook |
| `~/.nxs/history.json` | Last 50 analyses |
| `~/.nxs/cache.json` | 5-min LRU response cache (max 20 entries) |

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint + test on every PR to `main`
- **Publish** (`.github/workflows/publish.yml`): auto-publish to npm on push to `main` when `package.json` version changes
- **SonarCloud** (`.github/workflows/sonar.yml`): code quality + security scan on every PR

## Important constraints

- No TypeScript — plain ESM JavaScript (`"type": "module"`)
- Node >= 20 (uses `AbortSignal.timeout`, `fetch` built-in)
- Cognitive complexity limit: 15 per function (SonarCloud rule)
- No hardcoded secrets — use `// NOSONAR` only for false positives with a comment explaining why
- ReDoS-safe regex: use line-by-line `indexOf` approach, not backtracking quantifiers on unbounded input
