import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getNllbLanguageCode, NLLB_LANG_MAP } from '../offscreen/offscreen.js';
import { ensureOffscreenDocument, sendToOffscreen } from '../background/offscreen-manager.js';

test('getNllbLanguageCode maps common language names to NLLB BCP-47 codes', () => {
  assert.equal(getNllbLanguageCode('Українська'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('uk'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('Ukrainian'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('English'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('en'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('Polski'), 'pol_Latn');
  assert.equal(getNllbLanguageCode('Polish'), 'pol_Latn');
  assert.equal(getNllbLanguageCode('Deutsch'), 'deu_Latn');
  assert.equal(getNllbLanguageCode('German'), 'deu_Latn');
  assert.equal(getNllbLanguageCode('Français'), 'fra_Latn');
  assert.equal(getNllbLanguageCode('French'), 'fra_Latn');
  assert.equal(getNllbLanguageCode('Español'), 'spa_Latn');
  assert.equal(getNllbLanguageCode('Spanish'), 'spa_Latn');
  assert.equal(getNllbLanguageCode('Italiano'), 'ita_Latn');
  assert.equal(getNllbLanguageCode('Italian'), 'ita_Latn');
});

test('getNllbLanguageCode falls back gracefully for unknown or empty languages', () => {
  assert.equal(getNllbLanguageCode(''), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode(null), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode(undefined), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('unknown-lang'), 'ukr_Cyrl');
});

test('ensureOffscreenDocument and sendToOffscreen behave correctly with mocked chrome API', async () => {
  let createdDocumentCount = 0;
  let mockContexts = [];

  globalThis.chrome = {
    offscreen: {
      createDocument: async (opts) => {
        createdDocumentCount++;
        mockContexts.push({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        return true;
      }
    },
    runtime: {
      getContexts: async (filter) => {
        return mockContexts;
      },
      sendMessage: (message, callback) => {
        assert.equal(message.target, 'offscreen');
        if (message.type === 'FAIL_TEST') {
          callback({ ok: false, error: 'Custom error' });
        } else {
          callback({ ok: true, data: { result: 'translated' } });
        }
      },
      lastError: null
    }
  };

  try {
    // First call creates document
    await ensureOffscreenDocument();
    assert.equal(createdDocumentCount, 1);

    // Second call reuses existing document
    await ensureOffscreenDocument();
    assert.equal(createdDocumentCount, 1);

    // sendToOffscreen succeeds
    const res = await sendToOffscreen({ type: 'TRANSLATE_LOCAL_BATCH' });
    assert.deepEqual(res, { result: 'translated' });

    // sendToOffscreen rejects on error response
    await assert.rejects(
      () => sendToOffscreen({ type: 'FAIL_TEST' }),
      /Custom error/
    );

    // Verify target cannot be overridden by caller payload
    let capturedTarget = null;
    chrome.runtime.sendMessage = (msg, cb) => {
      capturedTarget = msg.target;
      cb({ ok: true, data: {} });
    };
    await sendToOffscreen({ type: 'TEST_OVERRIDE', target: 'malicious' });
    assert.equal(capturedTarget, 'offscreen', 'sendToOffscreen must enforce target: offscreen');
  } finally {
    delete globalThis.chrome;
  }
});

test('offscreen.js does not contain remote CDN imports and complies with MV3 CSP', () => {
  const code = fs.readFileSync(path.resolve('offscreen/offscreen.js'), 'utf8');
  assert.ok(!code.includes('cdn.jsdelivr.net'), 'offscreen.js must not import from cdn.jsdelivr.net');
  assert.ok(!code.includes('https://'), 'offscreen.js must not contain remote https import URLs');
  assert.ok(code.includes('./vendor/transformers.js'), 'offscreen.js must import from local ./vendor/transformers.js');
  assert.ok(code.includes("'webgpu' : 'wasm'"), 'offscreen.js must configure WebGPU/WASM device');
});

test('vendored transformers.js exists, is non-empty and exports pipeline and env', async () => {
  const vendorPath = path.resolve('offscreen/vendor/transformers.js');
  assert.ok(fs.existsSync(vendorPath), 'offscreen/vendor/transformers.js must exist');
  const stat = fs.statSync(vendorPath);
  assert.ok(stat.size > 100000, 'Vendored transformers.js should be the full bundled library');

  const fileUrl = `file://${vendorPath.replace(/\\/g, '/')}`;
  const imported = await import(fileUrl);
  assert.equal(typeof imported.pipeline, 'function', 'pipeline must be exported as a function');
  assert.equal(typeof imported.env, 'object', 'env must be exported as an object');
});

test('getNllbLanguageCode supports locale subtags like en-US, uk-UA, de-DE', () => {
  assert.equal(getNllbLanguageCode('en-US'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('uk-UA'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('de-DE'), 'deu_Latn');
  assert.equal(getNllbLanguageCode('fr-FR'), 'fra_Latn');
  assert.equal(getNllbLanguageCode('es-ES'), 'spa_Latn');
  assert.equal(getNllbLanguageCode('ru-RU'), 'rus_Cyrl');
});

test('download progress simulation is strictly monotonic and does not jump backwards', () => {
  const ESTIMATED_TOTAL = 916_800_000;
  const fileLoaded = {};
  let lastPercent = 0;

  function onProgress(p) {
    if (typeof p.loaded === 'number') {
      fileLoaded[p.file] = p.loaded;
    } else if (p.status === 'done' && p.total) {
      fileLoaded[p.file] = p.total;
    }
    let loadedBytes = 0;
    for (const b of Object.values(fileLoaded)) {
      loadedBytes += b;
    }
    const totalBytes = Math.max(ESTIMATED_TOTAL, loadedBytes);
    const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
    lastPercent = Math.max(lastPercent, percent);
    return lastPercent;
  }

  // File 1: config.json (873 bytes)
  let p1 = onProgress({ file: 'config.json', loaded: 873, total: 873, status: 'done' });
  assert.equal(p1, 0, 'Tiny config file should be 0% of full model download');

  // File 2: tokenizer.json (17.3 MB)
  let p2 = onProgress({ file: 'tokenizer.json', loaded: 17331224, total: 17331224, status: 'done' });
  assert.ok(p2 >= p1, 'Progress must not decrease on subsequent files');
  assert.equal(p2, 2);

  // File 3: encoder_model (halfway: ~200MB)
  let p3 = onProgress({ file: 'onnx/encoder_model_quantized.onnx', loaded: 200000000, total: 419120483, status: 'progress' });
  assert.ok(p3 >= p2, 'Progress must increase smoothly');
  assert.equal(p3, 24);

  // File 3: encoder_model done (~419MB)
  let p4 = onProgress({ file: 'onnx/encoder_model_quantized.onnx', loaded: 419120483, total: 419120483, status: 'done' });
  assert.ok(p4 >= p3);
  assert.equal(p4, 48);

  // File 4: decoder_model done (~475MB)
  let p5 = onProgress({ file: 'onnx/decoder_model_merged_quantized.onnx', loaded: 475505771, total: 475505771, status: 'done' });
  assert.ok(p5 >= p4);
  assert.equal(p5, 99);
});

test('LOCAL_MODEL_CONFIGS contains both OPUS-MT and NLLB-200 with appropriate sizes', async () => {
  const { LOCAL_MODEL_CONFIGS } = await import('../offscreen/offscreen.js');
  assert.ok(LOCAL_MODEL_CONFIGS['Xenova/opus-mt-en-uk'], 'Must contain OPUS-MT model');
  assert.ok(LOCAL_MODEL_CONFIGS['Xenova/nllb-200-distilled-600M'], 'Must contain NLLB model');
  assert.ok(LOCAL_MODEL_CONFIGS['Xenova/opus-mt-en-uk'].estimatedBytes < 150_000_000, 'OPUS-MT should be ~105MB');
  assert.ok(LOCAL_MODEL_CONFIGS['Xenova/nllb-200-distilled-600M'].estimatedBytes > 800_000_000, 'NLLB should be ~874MB');
});
