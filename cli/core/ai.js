import Anthropic from '@anthropic-ai/sdk';
import { matchRule } from './rules.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Shared call logic ──────────────────────────────────────────────────────

const GROQ_MAX_CHARS = 8000;

// Suffix appended to every tool system prompt — asks AI for the new fields
const AI_SCHEMA_SUFFIX = `

Additionally, always include these fields in your JSON response:
- "confidence": integer 0–100. How confident you are in this specific diagnosis given the log evidence. 95+ = textbook match. 70–94 = likely but needs verification. Below 70 = best guess.
- "impact": string. What concretely fails or degrades: which service, how many users affected, for how long.
- "suggestions": array of 2–3 strings. Proactive improvements BEYOND just fixing the immediate error — e.g. add monitoring, improve resilience, prevent recurrence.

CRITICAL RULE for "commands" field: Use the EXACT resource names, namespaces, pod names, image names, and values extracted from the log. NEVER use placeholders like <pod-name>, <namespace>, <image>, or <resource>. If a value appears in the log, use it verbatim in the command.`;

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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze a log with a tool-specific system prompt.
 *
 * Flow:
 *   1. Rule engine  — instant, no API call, confidence always set
 *   2. If fast=true → return rule result (or mock if no match)
 *   3. If confidence >= 95 from rules → return rule result (skip AI)
 *   4. Otherwise → call Groq / Anthropic with augmented prompt
 *
 * @param {string}   logText
 * @param {string}   systemPrompt  - the tool module provides this
 * @param {function} mockFn        - fallback when no API key
 * @param {object}   [opts]        - { fast: bool }
 */
export async function analyze(logText, systemPrompt, mockFn, opts = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  const antKey  = process.env.ANTHROPIC_API_KEY;

  // ── Rule engine (always runs first) ──────────────────────────────────────
  const ruleResult = matchRule(logText);

  // --fast / performance mode: rules only, no AI
  if (opts.fast) {
    if (ruleResult) return ruleResult;
    // No rule matched — fall back to mock
    const result = mockFn(logText);
    result._mock = true;
    result.confidence = result.confidence ?? 40;
    result.via = 'mock';
    return result;
  }

  // High-confidence rule match — skip AI entirely (saves API calls)
  if (ruleResult && ruleResult.confidence >= 95) {
    return ruleResult;
  }

  // Rule matched but confidence < 95 — pass as a hint to AI for better accuracy
  let augmentedPrompt = systemPrompt + AI_SCHEMA_SUFFIX;
  if (ruleResult) {
    augmentedPrompt += `\n\nRule engine pre-match (confidence ${ruleResult.confidence}%): ${ruleResult.id ?? 'matched'}. Use this as a starting point but verify against the actual log.`;
  }

  // ── Groq ──────────────────────────────────────────────────────────────────
  if (groqKey) {
    let input = logText;
    let truncated = false;
    if (input.length > GROQ_MAX_CHARS) { input = input.slice(0, GROQ_MAX_CHARS); truncated = true; }
    try {
      const raw = await callGroq(augmentedPrompt, `Analyze this log. In the "commands" field you MUST use the exact pod names, deployment names, namespaces, and other identifiers found in the log below — never generic placeholders like <pod-name> or <namespace>.\n\n${input}`);
      const result = JSON.parse(raw);
      if (truncated) result._truncated = true;
      result.via = 'ai-groq';
      if (result.confidence == null) result.confidence = 75; // AI didn't include it — default
      return result;
    } catch (groqErr) {
      const msg = groqErr.message ?? '';
      const isFallback = msg.includes('rate_limit') || msg.includes('Request too large') ||
                         msg.includes('quota') || msg.includes('fetch failed') ||
                         msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') ||
                         msg.includes('Failed to generate JSON') || msg.includes('json_validate_failed') ||
                         msg.includes('failed_generation');
      if (isFallback) {
        if (!antKey) {
          // Use rule result if available, else mock
          if (ruleResult) { ruleResult._warning = `Groq unavailable (${msg.slice(0, 60)}). Showing rule-matched response.`; return ruleResult; }
          const result = mockFn(logText);
          result._warning = `Groq unavailable (${msg.slice(0, 60)}). Showing mock response.`;
          result.confidence = result.confidence ?? 40;
          result.via = 'mock';
          return result;
        }
        // fall through to Anthropic
      } else {
        throw groqErr;
      }
    }
  }

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (antKey) {
    try {
      const raw = await callAnthropic(augmentedPrompt, `Analyze this log. In the "commands" field you MUST use the exact pod names, deployment names, namespaces, and other identifiers found in the log below — never generic placeholders like <pod-name> or <namespace>.\n\n${logText}`);
      const result = JSON.parse(raw);
      result.via = 'ai-anthropic';
      if (result.confidence == null) result.confidence = 75;
      return result;
    } catch (antErr) {
      const msg = antErr.message ?? '';
      const isFallback = msg.includes('rate_limit') || msg.includes('overloaded') ||
                         msg.includes('fetch failed') || msg.includes('ENOTFOUND');
      if (isFallback) {
        if (ruleResult) { ruleResult._warning = `Anthropic unavailable. Showing rule-matched response.`; return ruleResult; }
        const result = mockFn(logText);
        result._warning = `Anthropic unavailable (${msg.slice(0, 60)}). Showing mock response.`;
        result.confidence = result.confidence ?? 40;
        result.via = 'mock';
        return result;
      }
      throw antErr;
    }
  }

  // ── No API keys: prefer rule result over mock ─────────────────────────────
  if (ruleResult) {
    ruleResult._mock = true; // triggers demo mode banner
    return ruleResult;
  }

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

  if (process.env.GROQ_API_KEY) {
    return callGroq(context, messages, false);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(context, messages, false);
  }

  await delay(600);
  return 'Running in demo mode. Add GROQ_API_KEY or ANTHROPIC_API_KEY to enable real AI chat.';
}
