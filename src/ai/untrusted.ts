const DELIMITER_TAG = /<\s*\/?\s*(ticket|subject|description|thread|message|facts|policy|book_facts|system|instructions|previous_draft|admin_suggestions)\b[^>]*>/gi;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeUntrusted(text: string, maxChars: number): string {
  const cleaned = text
    .replace(CONTROL_CHARS, '')
    .replace(DELIMITER_TAG, (tag) => tag.replace(/</g, '‹').replace(/>/g, '›'))
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)} [truncated]` : cleaned;
}

export function sanitizeAttribute(text: string, maxChars: number): string {
  return sanitizeUntrusted(text, maxChars).replace(/["<>]/g, "'").replace(/\s+/g, ' ');
}
