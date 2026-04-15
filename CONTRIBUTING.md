# Contributing to nxs

Thanks for your interest in contributing!

## Setup

```bash
git clone https://github.com/gauravtayade11/nxs.git
cd nxs
npm install
node cli/index.js --help   # verify it works
```

## Requirements

- Node.js >= 20 (use `.node-version` with `nvm` or `fnm`)
- An AI provider key: `NXS_GROQ_API_KEY` or `ANTHROPIC_API_KEY`

## Shell completions (optional)

```bash
source <(node cli/index.js completion zsh)   # zsh
source <(node cli/index.js completion bash)  # bash
node cli/index.js completion fish > ~/.config/fish/completions/nxs.fish  # fish
```

## Running tests

```bash
npm test               # run all tests
npm run lint           # lint check
```

Tests run without any API key — they use a mock AI function.

## Project structure

```
cli/
├── index.js           # Entry point, registers all commands
├── core/
│   ├── ai.js          # AI provider abstraction (Anthropic / Groq)
│   ├── runner.js      # Shared analyze loop used by all tools
│   ├── rules.js       # Offline pattern-match rules engine
│   ├── redact.js      # Secret/token scrubbing before AI calls
│   ├── config.js      # Config + history persistence (~/.nxs/)
│   └── ui.js          # Banners, spinners, result printing
└── tools/
    ├── k8s.js         # nxs k8s — Kubernetes debugging
    ├── devops.js      # nxs devops — CI/CD errors
    ├── sec.js         # nxs sec — security scanning
    ├── predict.js     # nxs predict — failure prediction
    ├── incident.js    # nxs incident — incident commander
    ├── autopilot.js   # nxs autopilot — self-healing
    ├── noise.js       # nxs noise — alert fatigue analysis
    ├── blame.js       # nxs blame — deploy correlation
    ├── watch.js       # nxs watch — live log watcher
    └── ...            # cloud, db, net, ci, explain, rbac, serve, status
```

## Adding a new command

1. Create `cli/tools/mytool.js` — export `registerMytool(program)`
2. Import and call it in `cli/index.js`
3. Follow the existing pattern: use `runAnalyze()` from `core/runner.js`
4. Add tests in `cli/tests/mytool.test.js` if adding core logic

## Submitting a PR

- Keep PRs focused — one feature or fix per PR
- Run `npm test` and `npm run lint` before submitting
- Fill in the PR template
- Don't bump the version — maintainer handles releases

## What not to contribute

- Dependency upgrades — handled by Dependabot
- Changes to `.github/workflows/` — maintainer only
- Version bumps in `package.json`
