import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNllbLanguageCode, NLLB_LANG_MAP } from '../offscreen/offscreen.js';
import { ensureOffscreenDocument, sendToOffscreen } from '../background/offscreen-manager.js';

test('getNllbLanguageCode maps common language names to NLLB BCP-47 codes', () => {
  assert.equal(getNllbLanguageCode('Українська'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('uk'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('English'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('en'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('Polski'), 'pol_Latn');
  assert.equal(getNllbLanguageCode('Deutsch'), 'deu_Latn');
  assert.equal(getNllbLanguageCode('Français'), 'fra_Latn');
  assert.equal(getNllbLanguageCode('Español'), 'spa_Latn');
  assert.equal(getNllbLanguageCode('Italiano'), 'ita_Latn');
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
  } finally {
    delete globalThis.chrome;
  }
});
