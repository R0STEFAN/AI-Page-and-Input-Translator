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

  // Verify all declared icons exist on disk
  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    const fullPath = path.resolve(iconPath);
    assert.ok(fs.existsSync(fullPath), `Icon file ${iconPath} must exist`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `Icon file ${iconPath} must not be empty`);
  }
});
