function redact(value) {
  return String(value ?? '')
    .replace(/(api[_-]?key|authorization|token|secret)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]');
}

module.exports = { redact };
