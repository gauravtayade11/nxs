# `nxs k8s debug` Examples

Quick ways to get value from `nxs k8s` without changing your existing workflows.

This folder contains:

- `demo-namespace.yaml` – a small namespace with common K8s failure modes.
- `gh-actions-k8s-debug.yml` – GitHub Actions job that auto-analyzes failed `kubectl` commands.

> These are starter examples. Adjust namespaces, labels, and tools for your own cluster.

---

## 1. Demo Namespace — Break Glass Safely

`demo-namespace.yaml` creates a namespace with pods in common failure states:

- `crash-loop-demo`   – CrashLoopBackOff
- `image-pull-demo`   – ImagePullBackOff (bad image)
- `oom-demo`          – CrashLoopBackOff from OOMKilled
- `pending-demo`      – Pending due to fake constraints

Apply:

```bash
kubectl apply -f demo-namespace.yaml
kubectl get pods -n nxs-demo-bad
```

Then debug with `nxs`:

```bash
# Analyze a single pod
nxs k8s debug --pod crash-loop-demo -n nxs-demo-bad

# Analyze an entire deployment at once (all replicas)
nxs k8s debug --deployment crash-loop-demo -n nxs-demo-bad
```

Clean up:

```bash
kubectl delete namespace nxs-demo-bad
```

---

## 2. GitHub Actions — Auto-Debug K8s Failures

`gh-actions-k8s-debug.yml` shows how to pipe a failing `kubectl` command into `nxs k8s debug` and keep the diagnosis attached to the CI log.

Key parts:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install nxs CLI
        run: npm install -g @nextsight/nxs-cli

      - name: Apply manifests
        id: apply
        run: |
          # Example: this could fail with ImagePullBackOff, Pending, etc.
          set -o pipefail
          kubectl apply -f k8s/ 2>&1 | tee apply.log

      - name: Debug failures with nxs k8s
        if: failure()    # only run if previous step failed
        run: |
          echo "kubectl apply failed — analyzing with nxs k8s..."
          nxs k8s debug --stdin < apply.log
```

You can also:

- Run `kubectl describe pod ... | nxs k8s debug --stdin` when a smoke test fails.
- Attach `--output k8s-analysis.md` and upload the markdown as a CI artifact.

---

## 3. Local CLI — One-Liner Debug

For on-call / local debugging:

```bash
npm install -g @nextsight/nxs-cli
nxs config --setup    # add a free Groq key (console.groq.com)

# Classic crash loop:
nxs k8s debug --pod my-pod -n production

# From existing logs:
kubectl logs my-pod --previous -n production | nxs k8s debug --stdin
```

