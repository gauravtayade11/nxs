#!/usr/bin/env bash
# nxs Demo Setup Script
# Creates broken + healthy K8s resources for local testing
# Usage: bash demo/setup.sh [up|down|status]

set -e

ACTION="${1:-up}"
BAD_NS="nxs-demo-bad"
GOOD_NS="nxs-demo-good"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${CYAN}  →${RESET} $1"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $1"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $1"; }
err()  { echo -e "${RED}  ✗${RESET} $1"; }

check_kubectl() {
  if ! command -v kubectl &>/dev/null; then
    err "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/"
    exit 1
  fi
  if ! kubectl cluster-info &>/dev/null; then
    err "No Kubernetes cluster reachable. Start docker-desktop or kind."
    exit 1
  fi
  ok "kubectl connected: $(kubectl config current-context)"
}

setup() {
  echo ""
  echo -e "${BOLD}  ⚡ nxs Demo Setup${RESET}"
  echo -e "  Deploying broken + healthy workloads for local testing"
  echo ""

  check_kubectl

  # Create namespaces
  log "Creating namespaces..."
  kubectl create namespace "$BAD_NS"  --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
  kubectl create namespace "$GOOD_NS" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
  ok "Namespaces ready: $BAD_NS / $GOOD_NS"

  # Deploy broken pods
  echo ""
  log "Deploying WORST CASE pods (broken)..."

  kubectl apply -f "$SCRIPT_DIR/k8s/crash-loop.yaml" 2>/dev/null
  ok "crash-loop-demo   → CrashLoopBackOff (bad command)"

  kubectl apply -f "$SCRIPT_DIR/k8s/image-pull.yaml" 2>/dev/null
  ok "image-pull-demo   → ImagePullBackOff (non-existent image)"

  kubectl apply -f "$SCRIPT_DIR/k8s/oom-kill.yaml" 2>/dev/null
  ok "oom-demo          → OOMKilled (memory limit too low)"

  kubectl apply -f "$SCRIPT_DIR/k8s/pending.yaml" 2>/dev/null
  ok "pending-demo      → Pending (impossible nodeSelector)"

  # Deploy healthy pods
  echo ""
  log "Deploying GOOD CASE pods (healthy)..."

  kubectl apply -f "$SCRIPT_DIR/k8s/healthy.yaml" 2>/dev/null
  ok "healthy-demo      → Running (nginx, proper probes + limits)"

  echo ""
  log "Waiting for pods to settle (15s)..."
  sleep 15

  echo ""
  echo -e "${BOLD}  Setup complete. Pod status:${RESET}"
  echo ""
  echo -e "  ${YELLOW}BAD namespace ($BAD_NS):${RESET}"
  kubectl get pods -n "$BAD_NS" --no-headers 2>/dev/null | \
    awk '{printf "    %-30s %s\n", $1, $3}' || true

  echo ""
  echo -e "  ${GREEN}GOOD namespace ($GOOD_NS):${RESET}"
  kubectl get pods -n "$GOOD_NS" --no-headers 2>/dev/null | \
    awk '{printf "    %-30s %s\n", $1, $3}' || true

  echo ""
  echo -e "  ${BOLD}Ready to test. Run:${RESET}"
  echo ""
  echo -e "  ${CYAN}# WORST CASE tests${RESET}"
  echo -e "  nxs k8s debug --pod crash-loop-demo -n $BAD_NS --no-chat"
  echo -e "  nxs k8s debug --pod image-pull-demo -n $BAD_NS --no-chat"
  echo -e "  nxs k8s debug --pod oom-demo -n $BAD_NS --no-chat"
  echo -e "  nxs k8s debug --pod pending-demo -n $BAD_NS --no-chat"
  echo ""
  echo -e "  ${GREEN}# GOOD CASE tests${RESET}"
  echo -e "  nxs k8s debug --pod healthy-demo -n $GOOD_NS --no-chat"
  echo -e "  nxs k8s status"
  echo ""
  echo -e "  ${YELLOW}# LOG FILE tests (all tools)${RESET}"
  echo -e "  cat demo/logs/devops/docker-fail.log | nxs devops analyze --stdin --no-chat"
  echo -e "  cat demo/logs/sec/trivy-critical.log | nxs sec scan --stdin --no-chat"
  echo -e "  cat demo/logs/net/tls-expired.log    | nxs net diagnose --stdin --no-chat"
  echo -e "  cat demo/logs/db/postgres-too-many-conn.log | nxs db diagnose --stdin --no-chat"
  echo ""
  echo -e "  See DEMO_PLAN.md for all test scenarios."
  echo ""
}

teardown() {
  echo ""
  log "Removing all nxs demo resources..."

  kubectl delete namespace "$BAD_NS"  --ignore-not-found 2>/dev/null && ok "Deleted namespace: $BAD_NS"
  kubectl delete namespace "$GOOD_NS" --ignore-not-found 2>/dev/null && ok "Deleted namespace: $GOOD_NS"

  echo ""
  ok "Teardown complete. Your cluster is clean."
  echo ""
}

status() {
  echo ""
  echo -e "${BOLD}  nxs Demo Status${RESET}"
  echo ""

  check_kubectl

  echo -e "  ${YELLOW}$BAD_NS (broken pods):${RESET}"
  kubectl get pods -n "$BAD_NS" 2>/dev/null || warn "Namespace not found — run: bash demo/setup.sh up"

  echo ""
  echo -e "  ${GREEN}$GOOD_NS (healthy pods):${RESET}"
  kubectl get pods -n "$GOOD_NS" 2>/dev/null || warn "Namespace not found — run: bash demo/setup.sh up"
  echo ""
}

case "$ACTION" in
  up)       setup ;;
  down)     teardown ;;
  status)   status ;;
  *)
    echo "Usage: bash demo/setup.sh [up|down|status]"
    echo "  up      Deploy all demo resources"
    echo "  down    Remove all demo resources"
    echo "  status  Show current pod status"
    exit 1
    ;;
esac
