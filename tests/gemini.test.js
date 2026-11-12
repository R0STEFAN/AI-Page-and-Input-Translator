import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortModels, buildBatchTranslationPayload, parseGeminiResponse } from '../background/gemini.js';
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
