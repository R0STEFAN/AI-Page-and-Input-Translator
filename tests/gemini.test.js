import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortModels, buildBatchTranslationPayload, parseGeminiResponse, translateBatchGemini } from '../background/gemini.js';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../background/storage.js';

test('filterAndSortModels extracts generateContent models and prioritizes flash', () => {
  const mockApiData = {
    models: [
      { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
    ]
  };

  const models = filterAndSortModels(mockApiData);
  assert.deepEqual(models, [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ]);
});

test('filterAndSortModels handles models with missing or undefined name safely', () => {
  const mockApiData = {
    models: [
      { supportedGenerationMethods: ['generateContent'] },
      { name: null, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }
    ]
  };

  const models = filterAndSortModels(mockApiData);
  assert.deepEqual(models, ['gemini-2.5-flash']);
});

test('buildBatchTranslationPayload formats structured JSON request', () => {
  const texts = ['Hello world', 'Welcome to our blog'];
  const payload = buildBatchTranslationPayload(texts, 'Українська');

  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.ok(payload.contents[0].parts[0].text.includes('Hello world'));
  assert.ok(payload.contents[0].parts[0].text.includes('Українська'));
});

test('parseGeminiResponse extracts and validates translations array', () => {
  const mockResponse = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                translations: ['Привіт світ', 'Ласкаво просимо до нашого блогу']
              })
            }
          ]
        }
      }
    ]
  };

  const translations = parseGeminiResponse(mockResponse, 2);
  assert.deepEqual(translations, ['Привіт світ', 'Ласкаво просимо до нашого блогу']);
});

test('getSettings returns DEFAULT_SETTINGS when chrome.storage is not available', async () => {
  const settings = await getSettings();
  assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('saveSettings returns merged settings when chrome.storage is not available', async () => {
  const updated = await saveSettings({ geminiApiKey: 'test-key' });
  assert.equal(updated.geminiApiKey, 'test-key');
});

test('translateBatchGemini falls back to per-item translation if Gemini merges batch items into fewer outputs', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (url, options) => {
    callCount++;
    const body = JSON.parse(options.body);
    const promptText = body.contents[0].parts[0].text;

    // First call is the batch of 3 items -> simulate Gemini returning a merged 1-item response
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify({ translations: ['Merged One\nTwo\nThree'] }) }]
            }
          }]
        })
      };
    }

    // Subsequent individual calls (1 item each)
    let translated = 'Unknown';
    if (promptText.includes('First paragraph')) translated = 'Перший абзац';
    if (promptText.includes('Second paragraph')) translated = 'Другий абзац';
    if (promptText.includes('Third paragraph')) translated = 'Третій абзац';

    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ translations: [translated] }) }]
          }
        }]
      })
    };
  };

  try {
    const result = await translateBatchGemini(
      ['First paragraph', 'Second paragraph', 'Third paragraph'],
      'Українська',
      'gemini-2.5-flash',
      'fake-key'
    );

    assert.equal(result.length, 3, 'Must return exact same count as input');
    assert.deepEqual(result, ['Перший абзац', 'Другий абзац', 'Третій абзац']);
    assert.equal(callCount, 4, '1 failed batch + 3 individual fallbacks');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
