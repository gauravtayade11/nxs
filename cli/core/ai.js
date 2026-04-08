import Anthropic from '@anthropic-ai/sdk';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Shared call logic ──────────────────────────────────────────────────────

const GROQ_MAX_CHARS = 8000;

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
      ...(jsonMode ? { response_format: { type: 'json_object' } } : { max_tokens: 1024 }),
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error: ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(systemPrompt, messages) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
  });
  return response.content.find((b) => b.type === 'text')?.text ?? '';
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze a log with a tool-specific system prompt.
 * @param {string} logText
 * @param {string} systemPrompt  - the tool module provides this
 * @param {function} mockFn      - fallback when no API key
 */
export async function analyze(logText, systemPrompt, mockFn) {
  const groqKey = process.env.GROQ_API_KEY;
  const antKey  = process.env.ANTHROPIC_API_KEY;

  if (groqKey) {
    let input = logText;
    let truncated = false;
    if (input.length > GROQ_MAX_CHARS) { input = input.slice(0, GROQ_MAX_CHARS); truncated = true; }
    const raw = await callGroq(systemPrompt, `Analyze this log:\n\n${input}`);
    const result = JSON.parse(raw);
    if (truncated) result._truncated = true;
    return result;
  }

  if (antKey) {
    const raw = await callAnthropic(systemPrompt, `Analyze this log:\n\n${logText}`);
    return JSON.parse(raw);
  }

  return mockFn(logText);
}

/**
 * Follow-up chat with context from a previous analysis.
 */
export async function chat(logText, result, messages) {
  const context = `You are an expert engineer. You already analyzed this log:

LOG (excerpt): ${logText.slice(0, 3000)}

ANALYSIS:
- Tool: ${result.tool}
- Summary: ${result.summary}
- Root Cause: ${result.rootCause}
- Fix Steps: ${result.fixSteps}
- Commands: ${result.commands}

Answer follow-up questions concisely.`;

  if (process.env.GROQ_API_KEY) {
    return callGroq(context, messages, false);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(context, messages);
  }

  await delay(600);
  return 'Running in demo mode. Add GROQ_API_KEY or ANTHROPIC_API_KEY to enable real AI chat.';
}
