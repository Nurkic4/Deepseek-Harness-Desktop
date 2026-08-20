const DEFAULT_BROWSER_URL = 'https://www.google.com/';

function normalizeBrowserAddress(value, options = {}) {
  const input = String(value || '').trim();
  if (!input) return options.allowBlank ? 'about:blank' : DEFAULT_BROWSER_URL;
  if (options.allowBlank && input === 'about:blank') return input;

  let candidate = input;
  const looksLikeLocalHost = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(candidate);
  const looksLikeHost = looksLikeLocalHost || /^[^\s/]+\.[^\s/]{2,}(?::\d+)?(?:\/|$)/.test(candidate);
  if (looksLikeHost) {
    candidate = `${looksLikeLocalHost ? 'http' : 'https'}://${candidate}`;
  } else if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
  }

  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS addresses are supported.');
  }
  return parsed.toString();
}

function normalizeBrowserBounds(value, contentBounds) {
  const source = value && typeof value === 'object' ? value : {};
  const limit = contentBounds && typeof contentBounds === 'object'
    ? contentBounds
    : { width: 0, height: 0 };
  const x = Math.max(0, Math.floor(Number(source.x) || 0));
  const y = Math.max(0, Math.floor(Number(source.y) || 0));
  const maxWidth = Math.max(0, Math.floor(Number(limit.width) || 0) - x);
  const maxHeight = Math.max(0, Math.floor(Number(limit.height) || 0) - y);
  const width = Math.min(maxWidth, Math.max(0, Math.floor(Number(source.width) || 0)));
  const height = Math.min(maxHeight, Math.max(0, Math.floor(Number(source.height) || 0)));
  return { x, y, width, height };
}

function isUsableBrowserBounds(bounds) {
  return Boolean(bounds && bounds.width >= 80 && bounds.height >= 80);
}

module.exports = {
  DEFAULT_BROWSER_URL,
  normalizeBrowserAddress,
  normalizeBrowserBounds,
  isUsableBrowserBounds,
};
