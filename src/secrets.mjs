// Secret detection / redaction. Detection is pattern based and therefore best-effort:
// it reduces accidental leakage into notes, it is not a guarantee.
import { VymemError } from './errors.mjs';

export const BUILTIN_SECRET_PATTERNS = [
  { label: 'PEM private key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { label: 'OpenAI/Anthropic style secret key', re: /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'xAI token', re: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Groq API key', re: /\bgsk_[A-Za-z0-9]{20,}\b/ },
  { label: 'HuggingFace token', re: /\bhf_[A-Za-z0-9]{20,}\b/ },
  { label: 'Stripe secret key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z\-_]{30,}\b/ },
  { label: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: 'Database URI with credentials', re: /(?:postgres|postgresql|mongodb(?:\+srv)?|redis|mysql):\/\/[^:\s/]+:[^@\s/]+@/i },
  { label: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/i },
  {
    label: 'Hardcoded secret assignment',
    re: /(?:^|[\s"'`])(?:password|passwd|api_?key|access_?token|secret_?key|private_?key|client_?secret|auth_?token)\s*[:=]\s*["']?[A-Za-z0-9+/=._\-]{14,}["']?/i
  }
];

export const REDACTION_MARK = '<REDACTED_BY_VYMEM>';

export function compileExtraPatterns(extra = []) {
  const out = [];
  for (const item of extra) {
    if (!item || typeof item.pattern !== 'string') continue;
    try {
      out.push({ label: String(item.label || 'Custom pattern'), re: new RegExp(item.pattern, item.flags || '') });
    } catch {
      throw new VymemError('INVALID_CONFIG', `privacy.extraSecretPatterns contains an invalid regular expression: ${item.pattern}`);
    }
  }
  return out;
}

export function makeScanner(extra = []) {
  const patterns = [...BUILTIN_SECRET_PATTERNS, ...compileExtraPatterns(extra)];
  const detect = (text) => {
    if (typeof text !== 'string' || !text) return [];
    return patterns.filter(p => p.re.test(text)).map(p => p.label);
  };
  const redact = (text) => {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const { re } of patterns) {
      out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), REDACTION_MARK);
    }
    return out;
  };
  const assertNone = (text, context = 'payload') => {
    const hits = detect(text);
    if (hits.length) {
      throw new VymemError(
        'REJECTED_SECRET_DETECTED',
        `Potential secret material detected in ${context} (${hits.join(', ')}). Do not store secrets in notes.`,
        { detected: hits }
      );
    }
  };
  return { detect, redact, assertNone };
}

const defaultScanner = makeScanner();
export const detectSecrets = defaultScanner.detect;
export const redactSecrets = defaultScanner.redact;
export const assertNoSecrets = defaultScanner.assertNone;
