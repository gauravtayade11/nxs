/**
 * Tests for the rule engine — cli/core/rules.js
 * Run: node --test cli/tests/rules.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchRule, RULES } from '../core/rules.js';

// ── Shape ─────────────────────────────────────────────────────────────────

describe('RULES array', () => {
  test('has 19 rules', () => {
    assert.strictEqual(RULES.length, 19);
  });

  test('every rule has required fields', () => {
    for (const rule of RULES) {
      assert.ok(rule.id,                              `${rule.id}: missing id`);
      assert.ok(rule.test instanceof RegExp,          `${rule.id}: test must be RegExp`);
      assert.ok(rule.result.severity,                 `${rule.id}: missing severity`);
      assert.ok(rule.result.confidence,               `${rule.id}: missing confidence`);
      assert.ok(rule.result.summary,                  `${rule.id}: missing summary`);
      assert.ok(rule.result.rootCause,                `${rule.id}: missing rootCause`);
      assert.ok(rule.result.fixSteps,                 `${rule.id}: missing fixSteps`);
      assert.ok(rule.result.commands,                 `${rule.id}: missing commands`);
      assert.ok(Array.isArray(rule.result.suggestions), `${rule.id}: suggestions must be array`);
      assert.ok(rule.result.suggestions.length >= 1,  `${rule.id}: needs at least 1 suggestion`);
    }
  });

  test('all confidence values are 0–100', () => {
    for (const rule of RULES) {
      const c = rule.result.confidence;
      assert.ok(c >= 0 && c <= 100, `${rule.id}: confidence ${c} out of range`);
    }
  });

  test('severity is one of critical/warning/info', () => {
    const valid = new Set(['critical', 'warning', 'info']);
    for (const rule of RULES) {
      assert.ok(valid.has(rule.result.severity), `${rule.id}: invalid severity "${rule.result.severity}"`);
    }
  });
});

// ── matchRule ─────────────────────────────────────────────────────────────

describe('matchRule', () => {
  test('returns null for unrelated input', () => {
    assert.strictEqual(matchRule('deployment rolled out successfully'), null);
    assert.strictEqual(matchRule(''), null);
    assert.strictEqual(matchRule('All pods running. No issues detected.'), null);
  });

  test('result always tagged via: rules', () => {
    const result = matchRule('CrashLoopBackOff');
    assert.strictEqual(result.via, 'rules');
  });

  // ── Kubernetes ────────────────────────────────────────────────────────

  test('k8s-crashloop — CrashLoopBackOff', () => {
    const r = matchRule('pod/api-server: CrashLoopBackOff (8 restarts)');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 95);
  });

  test('k8s-oomkilled — OOMKilled', () => {
    const r = matchRule('Last State: Terminated  Reason: OOMKilled  Exit Code: 137');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 95);
  });

  test('k8s-oomkilled — exit code 137', () => {
    const r = matchRule('container exited with code 137');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('k8s-imagepull — ImagePullBackOff', () => {
    const r = matchRule('Failed to pull image "myrepo/app:v1": ImagePullBackOff');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 95);
  });

  test('k8s-imagepull — pull access denied', () => {
    const r = matchRule('pull access denied for myrepo/app, repository does not exist');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('k8s-pending — nodes not available', () => {
    const r = matchRule('0/3 nodes are available: insufficient memory');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 88);
  });

  test('k8s-create-container-error — configmap not found', () => {
    const r = matchRule('CreateContainerConfigError: configmap "app-config" not found');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 92);
  });

  test('k8s-evicted — DiskPressure', () => {
    const r = matchRule('The node had condition: DiskPressure');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 90);
  });

  test('k8s-rbac-forbidden — cannot get resource', () => {
    const r = matchRule('User "system:serviceaccount:default:api" cannot get resource "secrets"');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 85);
  });

  test('k8s-pvc-unbound — PVC pending', () => {
    const r = matchRule('PersistentVolumeClaim "data-pvc" is unbound');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 88);
  });

  test('k8s-node-not-ready — NotReady', () => {
    const r = matchRule('Node ip-10-0-1-5 is NotReady');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 90);
  });

  // ── CI / CD ───────────────────────────────────────────────────────────

  test('ci-npm-test-fail — jest failure', () => {
    const r = matchRule('FAIL src/auth.test.js\n  ● AuthService › login › returns 401');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('ci-docker-auth — unauthorized', () => {
    const r = matchRule('unauthorized: authentication required for docker pull');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 92);
  });

  test('ci-module-not-found — Cannot find module', () => {
    const r = matchRule("Error: Cannot find module 'express'");
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 88);
  });

  test('ci-module-not-found — Python ModuleNotFoundError', () => {
    const r = matchRule('ModuleNotFoundError: No module named requests_toolbelt');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('ci-syntax-error — SyntaxError', () => {
    const r = matchRule("SyntaxError: Unexpected token '}'");
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 85);
  });

  test('ci-connection-refused — ECONNREFUSED', () => {
    const r = matchRule('connect ECONNREFUSED 127.0.0.1:5432');
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 82);
  });

  test('ci-oom — out of memory', () => {
    const r = matchRule('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('ci-permission-denied — Permission denied', () => {
    const r = matchRule('Permission denied: ./scripts/deploy.sh');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 80);
  });

  test('ci-timeout — timeout exceeded', () => {
    const r = matchRule('Step exceeded the timeout limit of 30 minutes');
    assert.strictEqual(r.severity, 'warning');
    assert.strictEqual(r.confidence, 78);
  });

  test('ci-terraform-error — terraform apply failed', () => {
    const r = matchRule('Error: terraform apply failed — provider not found');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
  });

  test('ci-java-compile — BUILD FAILED', () => {
    const r = matchRule('BUILD FAILED\nerror: cannot find symbol UserRepository');
    assert.ok(r);
    assert.strictEqual(r.severity, 'critical');
    assert.strictEqual(r.confidence, 85);
  });
});
