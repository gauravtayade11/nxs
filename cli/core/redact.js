/**
 * Redact common sensitive patterns from log text before sending to AI APIs.
 * Used when --redact flag is passed to any analyze/diagnose/debug command.
 */

const PATTERNS = [
  // AWS credentials
  { label: 'AWS Access Key',    re: /\bAKIA[0-9A-Z]{16}\b/g,                           sub: '[REDACTED-AWS-KEY]' },
  { label: 'AWS Secret Key',    re: /(?<=aws_secret_access_key\s*[=:]\s*)\S+/gi,        sub: '[REDACTED]' },
  { label: 'AWS Session Token', re: /(?<=aws_session_token\s*[=:]\s*)\S+/gi,            sub: '[REDACTED]' },

  // Generic API keys / tokens
  { label: 'Bearer token',      re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,                  sub: 'Bearer [REDACTED-TOKEN]' },
  { label: 'Basic auth',        re: /Basic\s+[A-Za-z0-9+/]+=*/g,                        sub: 'Basic [REDACTED]' },
  { label: 'JWT token',         re: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g, sub: '[REDACTED-JWT]' },

  // Private keys / certs
  { label: 'PEM private key',   re: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, sub: '[REDACTED-PRIVATE-KEY]' },
  { label: 'PEM certificate',   re: /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, sub: '[REDACTED-CERT]' },

  // Passwords in connection strings / env vars
  { label: 'Password field',    re: /(?<=\b(?:password|passwd|pwd|secret|token|api_?key)\s*[=:]\s*)["']?[^\s"',;]+["']?/gi, sub: '[REDACTED]' },
  { label: 'DB connection URL', re: /(?:postgres|mysql|mongodb|redis|amqp|mssql):\/\/[^:]+:[^@]+@/gi, sub: (m) => m.replace(/:([^@]+)@/, ':[REDACTED]@') },

  // Cloud tokens
  { label: 'GCP service acct',  re: /"private_key"\s*:\s*"[^"]+"/g,                     sub: '"private_key": "[REDACTED]"' },
  { label: 'Azure SAS token',   re: /(?:sv|sig|se|sp|spr|srt|ss)=[A-Za-z0-9%+/=&]+/g,  sub: '[REDACTED-SAS]' },
  { label: 'Azure conn string', re: /AccountKey=[A-Za-z0-9+/=]+/g,                       sub: 'AccountKey=[REDACTED]' },

  // GitHub / npm tokens
  { label: 'GitHub token',      re: /\bghp_[A-Za-z0-9]{36}\b/g,                        sub: '[REDACTED-GITHUB-TOKEN]' },
  { label: 'npm token',         re: /\bnpm_[A-Za-z0-9]{36}\b/g,                        sub: '[REDACTED-NPM-TOKEN]' },
  { label: 'Groq API key',      re: /\bgsk_[A-Za-z0-9]{50,}\b/g,                       sub: '[REDACTED-GROQ-KEY]' },
  { label: 'Anthropic key',     re: /\bsk-ant-[A-Za-z0-9-]{50,}\b/g,                   sub: '[REDACTED-ANTHROPIC-KEY]' },
];

/**
 * Redact sensitive patterns from text.
 * @param {string} text
 * @returns {{ redacted: string, count: number, types: string[] }}
 */
export function redact(text) {
  let redacted = text;
  const found = new Set();

  for (const { label, re, sub } of PATTERNS) {
    const before = redacted;
    redacted = redacted.replace(re, typeof sub === 'function' ? sub : sub);
    if (redacted !== before) found.add(label);
  }

  return { redacted, count: found.size, types: [...found] };
}

/**
 * Warn if text *looks* like it may contain secrets (quick heuristic scan),
 * without modifying. Returns array of warning messages.
 */
export function warnIfSensitive(text) {
  const warnings = [];
  if (/AKIA[0-9A-Z]{16}/.test(text))                    warnings.push('Possible AWS Access Key detected');
  if (/password\s*[=:]/i.test(text))                    warnings.push('Possible password in log');
  if (/Bearer\s+[A-Za-z0-9]/i.test(text))               warnings.push('Possible auth token in log');
  if (/eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\./.test(text)) warnings.push('Possible JWT token in log');
  if (/-----BEGIN.*PRIVATE KEY/.test(text))             warnings.push('Possible private key in log');
  if (/AccountKey=[A-Za-z0-9+/=]+/.test(text))         warnings.push('Possible Azure storage key in log');
  return warnings;
}
debugger
