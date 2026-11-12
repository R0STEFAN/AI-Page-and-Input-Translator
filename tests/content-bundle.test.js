import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildContentBundle } from '../scripts/build-content.js';

test('content.bundle.js exists, is non-empty, and has no ES module import/export statements', () => {
  const bundlePath = path.resolve('content/content.bundle.js');
  assert.ok(fs.existsSync(bundlePath), 'content.bundle.js must exist on disk');

  const content = fs.readFileSync(bundlePath, 'utf8');
  assert.ok(content.length > 5000, 'content.bundle.js should contain bundled content modules');

  // Verify no static imports or exports exist (which crash Chrome MV3 classic content scripts)
  const lines = content.split('\n');
  const importLines = lines.filter(line => /^\s*import\s+/.test(line));
  const exportLines = lines.filter(line => /^\s*export\s+/.test(line));

  assert.deepEqual(importLines, [], 'content.bundle.js must NOT contain any static import statements');
  assert.deepEqual(exportLines, [], 'content.bundle.js must NOT contain any export statements');

  // Verify it is wrapped in an IIFE
  assert.ok(content.includes('(() => {'), 'Bundle must start with an IIFE');
  assert.ok(content.includes('})();'), 'Bundle must terminate the IIFE');

  // Verify node syntax check passes in script mode
  assert.doesNotThrow(() => {
    execSync(`node --check "${bundlePath}"`, { stdio: 'pipe' });
  });
});

test('manifest.json references content.bundle.js in content_scripts', () => {
  const manifestPath = path.resolve('manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(Array.isArray(manifest.content_scripts));
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].js, ['content/content.bundle.js']);
});

test('buildContentBundle rebuilds bundle successfully', () => {
  const out = buildContentBundle();
  assert.ok(fs.existsSync(out));
});
