# Changelog

All notable changes to `@nextsight/nxs-cli` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.1.3] — 2026-04-13

### Added
- **Test coverage 98.5%** — Anthropic path tests, cache eviction, config branch coverage, `prompt()` / `readStdin()` UI helpers
- `_setAnthropicCreate()` test seam in `ai.js` so Anthropic SDK tests never make real HTTP calls
- `config.js`: corrupt JSON fallback tests, all 5 `applyConfig` env vars covered

### Fixed
- Cache eviction test was using wrong cache key (plain prompt vs augmented prompt)
- `vercel.json`: removed invalid `rootDirectory` / `buildCommand` / `outputDirectory` properties

---

## [2.1.2] — 2026-04-11

### Added
- **GitHub Pages landing page** (`docs/index.html`) — commands grid, article series, all social links
- `vercel.json` — one-click Vercel deployment with security headers and cache-control
- `.github/workflows/pages.yml` — auto-deploy to GitHub Pages on push to `main`
- **Cross-cutting global flags**: `--no-color`, `--no-cache`, `--debug`, `--fail-on <severity>`
- `flags.test.js` — 26 tests covering all new global flags
- **Shell completions** (`nxs completion bash|zsh|fish`) — tab-complete all commands and flags
- `--redact` flag + sensitive-data warning on `nxs watch`
- Startup version check — hourly rate-limited, nudges on exit if newer version available
- OSS repo hygiene: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, Dependabot, CODEOWNERS, issue templates, `SECURITY.md`
- `npm files` field — trims published package to `cli/`, `scripts/`, docs only

### Fixed
- `--no-cache` test: `isCacheEnabled()` changed from module-level const to runtime function
- SonarCloud warnings in `watch.js`: negated condition (S7735) + nested ternary (S3358)

---

## [2.1.1] — 2026-04-11

### Fixed
- CI test failures: cache isolation between test suites, lint errors
- ReDoS vulnerability in kubectl namespace injection (`runner.js`)
- Shell injection hotspots — all user-supplied values now quoted
- SonarCloud credential false positives suppressed with `// NOSONAR`
- Cognitive complexity reduced across `k8s.js`, `predict.js`, `sec.js`, `notifySlack()`

---

## [2.1.0] — 2026-04-10

### Added
- `nxs noise` — alert fatigue analyzer: groups repeated errors, surfaces top patterns, tracks frequency over 7 days
- `nxs blame` — deploy-to-breakage correlator: cross-references deploy timestamps with error spikes (`--repo` flag)
- `nxs predict` — failure prediction: two-pass detection (state-based + resource-based), exact kubectl fix commands per pod
- `nxs incident` — incident commander: `declare / update / resolve` lifecycle with timeline and auto-summary
- `nxs autopilot` — self-healing loop: watches logs, AI triage, proposes and optionally applies fixes
- LRU response cache (`~/.nxs/cache.json`) — 5-min TTL, 20 entries max, file-backed across invocations
- `getPatternFrequency()` — tracks error recurrence for noise and predict tools
- Masked config input for API keys (`nxs config --setup`)

### Fixed
- CI context bleed between tools (history entries crossing tool boundaries)
- Log truncation now slices from tail (preserves most relevant end of long logs)

---

## [2.0.0] — 2026-04-09

### Added
- Initial npm release — `@nextsight/nxs-cli`
- **Anthropic `claude-opus-4-6`** as primary AI provider, Groq `llama-3.3-70b-versatile` as fallback
- `nxs k8s debug / describe / events` — Kubernetes log, resource, and event analyzer
- `nxs devops` — Docker / Terraform / CI pipeline error analyzer
- `nxs sec` — Trivy image/pod CVE scanner
- `nxs cloud` — AWS / GCP / Azure error analyzer
- `nxs net` — network diagnostics (DNS, connectivity, latency)
- `nxs db` — database connection monitor
- `nxs ci` — CI/CD pipeline analyzer (GitHub Actions, Jenkins, CircleCI)
- `nxs watch` — live log error detection
- `nxs explain` — plain-English error explainer
- `nxs rbac` — Kubernetes RBAC analyzer
- `nxs serve` — local AI proxy server
- Offline rules engine (`rules.js`) — instant answers for 20+ patterns with no API call
- `redact.js` — scrubs secrets/tokens before sending to AI
- Chat loop (`--chat`) — follow-up questions after any analysis
- `--fast` flag — rules-only mode across all tools
- Slack webhook notify on any analysis result
- SonarCloud integration — quality gate, coverage, security rating
- Config persistence (`~/.nxs/config.json`) + history (`~/.nxs/history.json`)
- npm provenance — every release verifiably built from GitHub Actions
