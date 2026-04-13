import Anthropic from '@anthropic-ai/sdk';
import { matchRule } from './rules.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Shared call logic ──────────────────────────────────────────────────────

const GROQ_MAX_CHARS = 8000;

const AI_SCHEMA_SUFFIX = `

Additionally, always include these fields in your JSON response:
- "confidence": integer 0–100. How confident you are in this specific diagnosis given the log evidence. 95+ = textbook match. 70–94 = likely but needs verification. Below 70 = best guess.
- "impact": string. What concretely fails or degrades: which service, how many users affected, for how long.
- "suggestions": array of 2–3 strings. Proactive improvements BEYOND just fixing the immediate error — e.g. add monitoring, improve resilience, prevent recurrence.

CRITICAL RULE for "commands" field: Use the EXACT resource names, namespaces, pod names, image names, and values extracted from the log. NEVER use placeholders like <pod-name>, <namespace>, <image>, or <resource>. If a value appears in the log, use it verbatim in the command.`;

const ANALYZE_USER_MSG = `Analyze this log. For the "commands" field: if pod names, deployment names, or namespaces appear in the log, use those exact values. If they do NOT appear in the log, do NOT use angle-bracket placeholders like <pod-name> or <namespace> — instead write the kubectl discovery command that would find them (e.g. "kubectl get pods -A | grep <keyword>" or "kubectl get pods --all-namespaces"). Never leave a command with an unresolved placeholder.`;

async function callGroq(systemPrompt, userMessage, jsonMode = true) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...(Array.isArray(userMessage) ? userMessage : [{ role: 'user', content: userMessage }]),
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : { max_tokens: 2048 }),
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(systemPrompt, messages, jsonMode = true) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: jsonMode ? 2048 : 4096,
    ...(jsonMode ? { thinking: { type: 'adaptive' } } : {}),
    system: systemPrompt,
    messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
  });
  return response.content.find((b) => b.type === 'text')?.text ?? '';
}

// ── Fallback helpers ───────────────────────────────────────────────────────

function mockFallback(mockFn, logText, warning) {
  const result = mockFn(logText);
  if (warning) result._warning = warning;
  result.confidence = result.confidence ?? 40;
  result.via = 'mock';
  return result;
}

function isFallbackError(msg, patterns) {
  return patterns.some((p) => msg.includes(p));
}

async function tryGroq(augmentedPrompt, logText, mockFn, ruleResult, antKey) {
  let input = logText;
  let truncated = false;
  if (input.length > GROQ_MAX_CHARS) { input = input.slice(-GROQ_MAX_CHARS); truncated = true; }

  try {
    const raw = await callGroq(augmentedPrompt, `${ANALYZE_USER_MSG}\n\n${input}`);
    const result = JSON.parse(raw);
    if (truncated) result._truncated = true;
    result.via = 'ai-groq';
    result.confidence = result.confidence ?? 75;
    return { result, fallthrough: false };
  } catch (error_) {
    const msg = error_.message ?? '';
    const fallback = isFallbackError(msg, [
      'rate_limit', 'Request too large', 'quota', 'fetch failed',
      'ENOTFOUND', 'ECONNREFUSED', 'Failed to generate JSON',
      'json_validate_failed', 'failed_generation',
    ]);
    if (!fallback) throw error_;
    if (antKey) return { result: null, fallthrough: true };
    const warning = `Groq unavailable (${msg.slice(0, 60)}). Showing ${ruleResult ? 'rule-matched' : 'mock'} response.`;
    if (ruleResult) { ruleResult._warning = warning; return { result: ruleResult, fallthrough: false }; }
    return { result: mockFallback(mockFn, logText, warning), fallthrough: false };
  }
}

async function tryAnthropic(augmentedPrompt, logText, mockFn, ruleResult) {
  try {
    const raw = await callAnthropic(augmentedPrompt, `${ANALYZE_USER_MSG}\n\n${logText}`);
    const result = JSON.parse(raw);
    result.via = 'ai-anthropic';
    result.confidence = result.confidence ?? 75;
    return result;
  } catch (error_) {
    const msg = error_.message ?? '';
    const fallback = isFallbackError(msg, ['rate_limit', 'overloaded', 'fetch failed', 'ENOTFOUND']);
    if (!fallback) throw error_;
    const warning = `Anthropic unavailable (${msg.slice(0, 60)}). Showing ${ruleResult ? 'rule-matched' : 'mock'} response.`;
    if (ruleResult) { ruleResult._warning = warning; return ruleResult; }
    return mockFallback(mockFn, logText, warning);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze a log with a tool-specific system prompt.
 *
 * Flow:
 *   1. Rule engine  — instant, no API call, confidence always set
 *   2. If fast=true → return rule result (or mock if no match)
 *   3. If confidence >= 95 from rules → return rule result (skip AI)
 *   4. Otherwise → call Groq / Anthropic with augmented prompt
 */
export async function analyze(logText, systemPrompt, mockFn, opts = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  const antKey  = process.env.ANTHROPIC_API_KEY;

  const ruleResult = matchRule(logText);

  // --fast: rules only, no AI
  if (opts.fast) {
    if (ruleResult) return ruleResult;
    const fastMock = mockFn(logText);
    fastMock._mock = true;
    fastMock.confidence = fastMock.confidence ?? 40;
    fastMock.via = 'mock';
    return fastMock;
  }

  // High-confidence rule match — skip AI
  if (ruleResult && ruleResult.confidence >= 95) return ruleResult;

  // Augment prompt with rule hint if partial match
  let augmentedPrompt = systemPrompt + AI_SCHEMA_SUFFIX;
  if (ruleResult) {
    augmentedPrompt += `\n\nRule engine pre-match (confidence ${ruleResult.confidence}%): ${ruleResult.id ?? 'matched'}. Use this as a starting point but verify against the actual log.`;
  }

  if (groqKey) {
    const { result, fallthrough } = await tryGroq(augmentedPrompt, logText, mockFn, ruleResult, antKey);
    if (!fallthrough) return result;
  }

  if (antKey) return tryAnthropic(augmentedPrompt, logText, mockFn, ruleResult);

  // No API keys
  if (ruleResult) { ruleResult._mock = true; return ruleResult; }
  const result = mockFn(logText);
  result._mock = true;
  result.confidence = result.confidence ?? 40;
  result.via = 'mock';
  return result;
}

/**
 * Follow-up chat with context from a previous analysis.
 */
export async function chat(logText, result, messages) {
  const context = `You are a senior DevOps/SRE engineer doing live incident response. You already diagnosed this error.

LOG (excerpt):
${logText.slice(0, 3000)}

YOUR DIAGNOSIS:
- Tool: ${result.tool}
- Severity: ${result.severity}
- Summary: ${result.summary}
- Root Cause: ${result.rootCause}
- Fix Steps: ${result.fixSteps}
- Commands: ${result.commands}

Rules for follow-up answers:
1. Give EXACT, runnable commands — use the real resource names, namespaces, and values from the log above. Never use placeholders like <pod-name> or <namespace>.
2. If the exact value is not in the log, say so explicitly and give the command with a note on how to find it.
3. Be direct and actionable — skip preamble. Lead with the command or the answer.
4. If asked how to fix something, give the full fix sequence: find → verify → apply → confirm.`;

  if (process.env.GROQ_API_KEY) return callGroq(context, messages, false);
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic(context, messages, false);

  await delay(600);
  return 'Running in demo mode. Add GROQ_API_KEY or ANTHROPIC_API_KEY to enable real AI chat.';
}
