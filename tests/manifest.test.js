import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('manifest.json exists and has valid MV3 fields', () => {
  const manifestPath = path.resolve('manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'AI Page Translator');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.action && manifest.action.default_popup);

  // Verify host permissions
  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  assert.ok(
    manifest.host_permissions.some(p => p.includes('generativelanguage.googleapis.com')),
    'host_permissions must include Gemini API URL'
  );
  assert.ok(
    manifest.host_permissions.some(p => p.includes('huggingface.co')),
    'host_permissions must include Hugging Face URL'
  );

  // Verify content scripts
  assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
  assert.ok(manifest.content_scripts.length > 0, 'content_scripts must have at least one entry');
  assert.ok(
    manifest.content_scripts[0].js.includes('content/content.bundle.js'),
    'content_scripts must reference bundled script content/content.bundle.js'
  );

  // Verify all declared icons exist on disk
  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    const fullPath = path.resolve(iconPath);
    assert.ok(fs.existsSync(fullPath), `Icon file ${iconPath} must exist`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `Icon file ${iconPath} must not be empty`);
  }
});
