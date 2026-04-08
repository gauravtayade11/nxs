import Anthropic from '@anthropic-ai/sdk';

// --- Mock responses used when no API key is configured ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOCK_RESPONSES = {
  kubernetes: {
    tool: 'kubernetes',
    summary: 'The Pod is failing to start because it cannot pull the container image from the registry.',
    rootCause: 'Kubernetes is returning an `ImagePullBackOff` error. This usually happens when:\n1. The image name or tag is misspelled.\n2. The registry requires authentication (ImagePullSecrets missing).\n3. The image does not exist in the specified repository.',
    fixSteps: '- Verify the spelling of the image name and tag in your deployment manifest.\n- Check if the image exists in the registry.\n- If it\'s a private registry, ensure you have attached the correct `imagePullSecrets`.',
    commands: 'kubectl describe pod <pod_name>\nkubectl get events --sort-by=\'.metadata.creationTimestamp\''
  },
  docker: {
    tool: 'docker',
    summary: 'The Docker build is failing because it cannot execute a command in the container.',
    rootCause: 'The executor failed running `/bin/sh`. This often indicates that the base image does not have the specified shell, or a command run during the build process exited with a non-zero status code due to a missing dependency.',
    fixSteps: '- Ensure the base image contains the tools you are trying to use.\n- Try running the build with `--no-cache` to ensure a fresh start.\n- Break down combined RUN commands to isolate the exact step that fails.',
    commands: 'docker build --no-cache -t my-app .\ndocker run -it --entrypoint /bin/sh <base_image>'
  },
  terraform: {
    tool: 'terraform',
    summary: 'Terraform encountered an invalid resource configuration.',
    rootCause: 'The AWS provider schema has changed, or a required attribute is missing in the resource definition. Check the specific resource block mentioned in the log.',
    fixSteps: '- Identify the missing required argument in your `.tf` file.\n- Check the Terraform registry documentation for the specific provider version you are using.\n- Run `terraform validate` to catch syntax issues early.',
    commands: 'terraform fmt\nterraform validate\nterraform plan -refresh=false'
  },
  ci: {
    tool: 'ci',
    summary: 'The CI pipeline failed during the installation of npm dependencies.',
    rootCause: 'A post-install script or a missing native build dependency (like `node-gyp`, Python, or CMake) is causing the `npm install` step to fail.',
    fixSteps: '- Review `package.json` for custom `postinstall` scripts.\n- Ensure the CI runner environment has build-essential tools installed.\n- Try switching to `npm ci` instead of `npm install` for more reliable builds.',
    commands: 'npm ci\nnpm cache clean --force\nrm -rf node_modules && npm install'
  },
  unknown: {
    tool: 'unknown',
    summary: 'An unspecified error occurred in the execution context.',
    rootCause: 'Could not clearly determine the root cause from the provided logs. The output suggests a generalized failure potentially linked to environment misconfiguration.',
    fixSteps: '- Increase the logging verbosity.\n- Check system resource limits (RAM/CPU).\n- Validate environment variables used during the process.',
    commands: 'export DEBUG=*\nenv | sort\ntop -n 1'
  }
};

const mockAnalyze = async (logText) => {
  await delay(1200);
  const lower = logText.toLowerCase();
  if (lower.includes('crashloopbackoff') || lower.includes('imagepullbackoff') || lower.includes('kubectl')) {
    return MOCK_RESPONSES.kubernetes;
  } else if (lower.includes('docker') || lower.includes('failed to solve: executor failed')) {
    return MOCK_RESPONSES.docker;
  } else if (lower.includes('terraform') || lower.includes('error: invalid resource')) {
    return MOCK_RESPONSES.terraform;
  } else if (lower.includes('npm install') || lower.includes('jenkins') || lower.includes('github actions')) {
    return MOCK_RESPONSES.ci;
  }
  return MOCK_RESPONSES.unknown;
};

// Groq free tier: 12k tokens/min limit. Cap log at ~8k chars (~2k tokens) to stay safe.
const GROQ_MAX_CHARS = 8000;

// --- Groq API (free tier, OpenAI-compatible) ---
const groqAnalyze = async (logText) => {
  let truncated = false;
  let input = logText;
  if (input.length > GROQ_MAX_CHARS) {
    input = input.slice(0, GROQ_MAX_CHARS);
    truncated = true;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Analyze this log:\n\n${input}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);
  if (truncated) {
    result.summary = `[Log truncated to ${GROQ_MAX_CHARS} chars for free tier] ${result.summary}`;
  }
  return result;
};

// --- Follow-up chat ---
export const chatFollowUp = async (logText, analysisResult, messages) => {
  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;

  const context = `You are an expert DevOps engineer. You already analyzed this log and produced the following findings:

ORIGINAL LOG (excerpt):
${logText.slice(0, 3000)}

PREVIOUS ANALYSIS:
- Tool: ${analysisResult.tool}
- Summary: ${analysisResult.summary}
- Root Cause: ${analysisResult.rootCause}
- Fix Steps: ${analysisResult.fixSteps}
- Commands: ${analysisResult.commands}

Answer the user's follow-up questions concisely and accurately based on this context.`;

  if (groqKey) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: context },
          ...messages,
        ],
        max_tokens: 1024,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Groq API error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }

  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: context,
      messages,
    });
    return response.content.find((b) => b.type === 'text')?.text ?? '';
  }

  // Mock fallback
  await delay(800);
  return "I'm running in demo mode without an API key. Add a Groq or Anthropic key in your `.env` file to enable follow-up questions.";
};

// --- Real Claude API ---
const SYSTEM_PROMPT = `You are an expert DevOps and platform engineer. Analyze the provided log, error output, or stack trace and return a JSON object with exactly this structure:

{
  "tool": "<one of: kubernetes, docker, terraform, ci, unknown>",
  "summary": "<1-2 sentence summary of the error>",
  "rootCause": "<detailed explanation of the root cause, use a numbered list if there are multiple likely causes>",
  "fixSteps": "<step-by-step fix instructions, use - for each bullet point>",
  "commands": "<relevant shell commands to investigate or fix the issue, one per line>"
}

Detect the tool type from context clues:
- kubernetes: kubectl, pod, namespace, deployment, ImagePullBackOff, CrashLoopBackOff, k8s
- docker: docker build/run/compose, Dockerfile, container layers
- terraform: terraform, .tf files, provider blocks, resource blocks, plan/apply
- ci: GitHub Actions, Jenkins, GitLab CI, CircleCI, npm/pip install failures, pipeline stages
- unknown: anything else

Return ONLY valid JSON with no markdown fences or extra text.`;

export const analyzeLog = async (logText) => {
  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;

  // Groq (free) takes priority if set, then Anthropic, then mock
  if (groqKey) {
    return groqAnalyze(logText);
  }

  if (!anthropicKey) {
    return mockAnalyze(logText);
  }

  const apiKey = anthropicKey;

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `Analyze this log:\n\n${logText}` },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text response received from Claude.');
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new Error('Claude returned an unexpected response format. Please try again.');
  }
};
