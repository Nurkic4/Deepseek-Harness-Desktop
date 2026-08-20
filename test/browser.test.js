const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BROWSER_URL,
  normalizeBrowserAddress,
  normalizeBrowserBounds,
  isUsableBrowserBounds,
} = require('../src/shared/browser');

test('browser address normalization accepts web URLs and local development hosts', () => {
  assert.equal(normalizeBrowserAddress('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizeBrowserAddress('example.com/path'), 'https://example.com/path');
  assert.equal(normalizeBrowserAddress('localhost:3080/settings'), 'http://localhost:3080/settings');
  assert.equal(normalizeBrowserAddress('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(normalizeBrowserAddress(''), DEFAULT_BROWSER_URL);
  assert.equal(normalizeBrowserAddress('', { allowBlank: true }), 'about:blank');
});

test('browser address normalization turns plain text into a search', () => {
  assert.equal(
    normalizeBrowserAddress('DSH 内置浏览器'),
    'https://www.google.com/search?q=DSH%20%E5%86%85%E7%BD%AE%E6%B5%8F%E8%A7%88%E5%99%A8',
  );
});

test('browser address normalization rejects non-web schemes', () => {
  assert.throws(() => normalizeBrowserAddress('file:///C:/secret.txt'), /HTTP and HTTPS/);
  assert.throws(() => normalizeBrowserAddress('javascript:alert(1)'), /HTTP and HTTPS/);
  assert.throws(() => normalizeBrowserAddress('data:text/html,test'), /HTTP and HTTPS/);
});

test('browser bounds are integral and clipped to the window content area', () => {
  assert.deepEqual(
    normalizeBrowserBounds({ x: 10.9, y: 20.8, width: 900, height: 700 }, { width: 800, height: 600 }),
    { x: 10, y: 20, width: 790, height: 580 },
  );
  assert.deepEqual(
    normalizeBrowserBounds({ x: -10, y: -20, width: -1, height: 90 }, { width: 800, height: 600 }),
    { x: 0, y: 0, width: 0, height: 90 },
  );
});

test('browser view needs a usable viewport', () => {
  assert.equal(isUsableBrowserBounds({ width: 80, height: 80 }), true);
  assert.equal(isUsableBrowserBounds({ width: 79, height: 200 }), false);
  assert.equal(isUsableBrowserBounds({ width: 200, height: 79 }), false);
  assert.equal(isUsableBrowserBounds(null), false);
});
