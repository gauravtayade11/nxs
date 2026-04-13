# `nxs predict` Examples

Practical ways to use `nxs predict` to catch OOMKills / CrashLoops **before** they wake you up.

This folder contains:

- `cronjob.yaml` – run `nxs predict` as a Kubernetes CronJob and notify Slack.
- `github-actions-gate.yml` – gate a deploy in GitHub Actions on cluster health.

> These are examples, not production defaults. Tweak namespaces, images, and thresholds for your environment.

---

## 1. Kubernetes CronJob — Nightly Cluster Scan

`cronjob.yaml` runs `nxs predict` inside the cluster and posts a summary to Slack.

It assumes:

- You have a namespace (e.g. `platform-tools`) where you run internal tooling.
- A ServiceAccount with permissions to:
  - `get`, `list` pods, deployments, namespaces
  - use `kubectl top` (if metrics-server is installed)
- A Secret with:
  - `GROQ_API_KEY` – optional, for AI-powered explanations
  - `SLACK_WEBHOOK_URL` – incoming webhook for your alerts channel

Apply:

```bash
kubectl apply -f cronjob.yaml -n platform-tools
```

What it does:

- Runs every night at 01:00.
- Calls:

  ```bash
  nxs predict -n production --ai --notify slack
  ```

- Posts a Slack message with:
  - At-risk pods (CrashLoopBackOff / OOMKilled / Pending)
  - Why they’re at risk
  - Suggested fixes

If `GROQ_API_KEY` is not set, it falls back to the rules engine only.

---

## 2. GitHub Actions — Gate Deploys on OOM Risk

`github-actions-gate.yml` shows how to block a deploy if `nxs predict` finds **critical** risks in your production namespace.

Key bits:

```yaml
jobs:
  predict-risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install nxs
        run: npm install -g @nextsight/nxs-cli

      - name: Check cluster health with nxs predict
        run: |
          nxs predict -n production --json \
            | jq '.risks[] | select(.severity == "critical")' \
            | grep -q . && {
                echo 'Critical risks detected by nxs predict — failing build';
                exit 1;
              } || echo 'No critical risks detected';
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

Notes:

- This assumes your CI runner has `kubectl` configured with access to the cluster.
- You can adjust:
  - Namespace (`-n production` → `-n staging`)
  - Threshold (filter on `"warning"` as well)
  - Behavior (fail build vs. just warn)

Drop this job into your deploy workflow, and make your deploy job depend on `predict-risk`.

---

## 3. Local CLI — Quick Check

For quick checks from your laptop (no CI / CronJob):

```bash
npm install -g @nextsight/nxs-cli
nxs config --setup    # add a free Groq key (console.groq.com)

# See which pods are at risk in your current context
nxs predict -n production
```

Pair it with `watch` when drilling into a single namespace:

```bash
watch -n 60 'nxs predict -n staging'
```

