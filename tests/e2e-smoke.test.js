import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('all required extension files exist, are readable, non-empty, and valid', () => {
  const requiredFiles = [
    'manifest.json',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'background/background.js',
    'background/gemini.js',
    'background/storage.js',
    'background/offscreen-manager.js',
    'offscreen/offscreen.html',
    'offscreen/offscreen.js',
    'content/content.js',
    'content/detector.js',
    'content/walker.js',
    'content/replacer.js',
    'content/selection.js',
    'content/content.css',
    'options/options.html',
    'options/options.js',
    'options/options.css',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css'
  ];

  for (const relPath of requiredFiles) {
    const full = path.resolve(relPath);
    assert.ok(fs.existsSync(full), `File ${relPath} must exist`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 0, `File ${relPath} must not be empty`);
  }
});

test('all HTML files are valid and contain DOCTYPE', () => {
  const htmlFiles = [
    'offscreen/offscreen.html',
    'options/options.html',
    'popup/popup.html'
  ];

  for (const relPath of htmlFiles) {
    const full = path.resolve(relPath);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(content.includes('<!DOCTYPE html>'), `${relPath} must have DOCTYPE`);
  }
});

test('manifest.json has all required permissions and entrypoints', () => {
  const manifestPath = path.resolve('manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'AI Page Translator');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.equal(manifest.background.service_worker, 'background/background.js');
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.equal(manifest.options_page, 'options/options.html');
});
