// scripts/download-transformers.js
// Downloads and vendors @xenova/transformers locally for MV3 CSP compliance

import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const url = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  console.log(`Fetching Transformers.js from ${url}...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const rawText = await res.text();
  const vendorDir = path.resolve('offscreen/vendor');
  if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
  }

  // Prepend self polyfill so it can be safely imported in Node test environments as well as browser
  const bundledText = `// Vendored @xenova/transformers@2.17.2 for MV3 CSP compliance
if (typeof self === 'undefined') {
  globalThis.self = globalThis;
}
${rawText}
`;

  const targetPath = path.join(vendorDir, 'transformers.js');
  fs.writeFileSync(targetPath, bundledText, 'utf8');
  console.log(`Saved vendored transformers bundle to ${targetPath} (${bundledText.length} bytes)`);

  // Verification test
  const imported = await import(`file://${targetPath.replace(/\\/g, '/')}`);
  if (typeof imported.pipeline !== 'function' || typeof imported.env !== 'object') {
    throw new Error('Verification failed: pipeline or env not exported correctly!');
  }
  console.log('Verification succeeded: pipeline and env successfully exported.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
