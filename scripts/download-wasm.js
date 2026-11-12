import fs from 'node:fs';
import path from 'node:path';

const wasmDir = path.resolve('offscreen/vendor/wasm');
if (!fs.existsSync(wasmDir)) {
  fs.mkdirSync(wasmDir, { recursive: true });
}

const files = [
  'ort-wasm-simd.wasm',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm.wasm',
  'ort-wasm-threaded.wasm'
];

const baseUrl = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';

console.log('Downloading ONNX WASM binaries to offscreen/vendor/wasm/...');

for (const file of files) {
  const destPath = path.join(wasmDir, file);
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    console.log(`Already exists: ${file} (${fs.statSync(destPath).size} bytes)`);
    continue;
  }

  const url = baseUrl + file;
  console.log(`Downloading ${file} from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${file}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`Saved ${file} (${buffer.length} bytes)`);
}

console.log('All WASM files downloaded successfully.');
