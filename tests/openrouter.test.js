import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isFreeOpenRouterModel,
  filterAndSortFreeModels,
  parseOpenRouterResponse,
  buildOpenRouterBatchPayload,
  buildOpenRouterInputPayload,
  fetchOpenRouterModels,
  translateBatchOpenRouter,
  translateInputOpenRouter
} from '../background/openrouter.js';
import { DEFAULT_SETTINGS } from '../background/storage.js';
import { handleMessage, routeTranslation } from '../background/background.js';
import { updateEngineVisibility, initOptions } from '../options/options.js';
import { initPopup } from '../popup/popup.js';

test('manifest.json permits https://openrouter.ai/* and storage has OpenRouter defaults', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://openrouter.ai/*'));
  assert.equal(DEFAULT_SETTINGS.openrouterApiKey, '');
  assert.equal(DEFAULT_SETTINGS.openrouterModel, 'openrouter/free');
  assert.ok(Array.isArray(DEFAULT_SETTINGS.openrouterAvailableModels));
  assert.ok(DEFAULT_SETTINGS.openrouterAvailableModels.includes('openrouter/free'));
});

test('filterAndSortFreeModels keeps only free text-capable models and puts openrouter/free first', () => {
  const apiData = {
    data: [
      { id: 'openai/gpt-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
      { id: 'qwen/qwen-2.5-72b-instruct:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } },
      { id: 'some/image-gen:free', architecture: { output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0' } },
      { id: 'custom/zero-priced-text', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } }
    ]
  };

  assert.equal(isFreeOpenRouterModel(apiData.data[0]), false);
  assert.equal(isFreeOpenRouterModel(apiData.data[4]), false);

  const models = filterAndSortFreeModels(apiData);
  assert.equal(models[0], 'openrouter/free');
  assert.ok(models.includes('qwen/qwen-2.5-72b-instruct:free'));
  assert.ok(models.includes('meta-llama/llama-3.3-70b-instruct:free'));
  assert.ok(models.includes('custom/zero-priced-text'));
  assert.ok(!models.includes('openai/gpt-4o'));
  assert.ok(!models.includes('some/image-gen:free'));
});

test('parseOpenRouterResponse handles markdown fences, <think> blocks, and single-item plain text fallback', () => {
  const fencedJson = {
    choices: [
      {
        message: {
          content: '<think>reasoning...</think>\n```json\n{"translations": ["Привіт", "Світ"]}\n```'
        }
      }
    ]
  };
  assert.deepEqual(parseOpenRouterResponse(fencedJson, 2), ['Привіт', 'Світ']);

  const plainSingle = {
    choices: [
      {
        message: {
          content: '<think>ok</think>Hello world!'
        }
      }
    ]
  };
  assert.deepEqual(parseOpenRouterResponse(plainSingle, 1), ['Hello world!']);
});

test('translateBatchOpenRouter falls back to per-item translation on batch count mismatch', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (_url, opts) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ translations: ['Merged'] }) } }]
        })
      };
    }
    const content = JSON.parse(opts.body).messages[0].content;
    const translated = content.includes('One') ? 'Item 1' : 'Item 2';
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ translations: [translated] }) } }]
      })
    };
  };

  try {
    const result = await translateBatchOpenRouter(['One', 'Two'], 'Українська', 'openrouter/free', 'sk-or-test');
    assert.deepEqual(result, ['Item 1', 'Item 2']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildOpenRouterBatchPayload and buildOpenRouterInputPayload build expected chat payloads', () => {
  const batch = buildOpenRouterBatchPayload(['Hello'], 'Українська', 'meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(batch.model, 'meta-llama/llama-3.3-70b-instruct:free');
  assert.ok(batch.messages[0].content.includes('Українська'));

  const input = buildOpenRouterInputPayload('Привіт', 'English', 'openrouter/free');
  assert.equal(input.model, 'openrouter/free');
  assert.ok(input.messages[0].content.includes('English'));
});

test('routeTranslation and handleMessage support openrouter engine end-to-end', async () => {
  let called = '';
  routeTranslation('openrouter', () => { called = 'gemini'; }, () => { called = 'local'; }, () => { called = 'openrouter'; });
  assert.equal(called, 'openrouter');

  const originalFetch = globalThis.fetch;
  const savedPatches = [];
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'openrouter',
          openrouterApiKey: 'sk-or-test',
          openrouterModel: 'openrouter/free',
          targetLanguage: 'Українська',
          inputTargetLanguage: 'English'
        }),
        set: async (patch) => { savedPatches.push(patch); }
      }
    }
  };

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/api/v1/models')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } },
            { id: 'deepseek/deepseek-chat:free', pricing: { prompt: '0', completion: '0' } }
          ]
        })
      };
    }
    const body = JSON.parse(opts.body);
    if (body.messages[0].content.includes('Draft text')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"translations":["Sounds good!"]}' } }] })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"translations":["Привіт"]}' } }] })
    };
  };

  try {
    const modelsRes = await new Promise(resolve => {
      handleMessage({ type: 'FETCH_OPENROUTER_MODELS', payload: { apiKey: 'sk-or-test' } }, {}, resolve);
    });
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.data.models, ['openrouter/free', 'deepseek/deepseek-chat:free']);
    assert.ok(savedPatches.some(p => Array.isArray(p.openrouterAvailableModels)));

    const batchRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_BATCH', payload: { texts: ['Hello'] } }, {}, resolve);
    });
    assert.equal(batchRes.ok, true);
    assert.deepEqual(batchRes.data.translations, ['Привіт']);

    const inputRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_INPUT', payload: { text: 'Класно!' } }, {}, resolve);
    });
    assert.equal(inputRes.ok, true);
    assert.equal(inputRes.data.translation, 'Sounds good!');
  } finally {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  }
});

test('options.html, options.js and popup.js integrate OpenRouter controls and readiness checks', async () => {
  const html = fs.readFileSync(path.resolve('options/options.html'), 'utf8');
  for (const id of ['engineOpenRouter', 'openrouterSection', 'openrouterApiKey', 'toggleOpenRouterApiKey', 'fetchOpenRouterModelsBtn', 'openrouterModelSelect']) {
    assert.ok(html.includes(`id="${id}"`), `options.html missing id="${id}"`);
  }

  const makeSection = () => {
    const classes = new Set();
    return {
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c)
      }
    };
  };
  const g = makeSection();
  const l = makeSection();
  const o = makeSection();
  updateEngineVisibility('openrouter', g, l, o);
  assert.ok(g.classList.contains('hidden'));
  assert.ok(l.classList.contains('hidden'));
  assert.ok(!o.classList.contains('hidden'));

  // Test popup OpenRouter badge & missing key guard
  const elements = new Map();
  const makeEl = (id) => {
    const classes = new Set(id === 'alertBox' || id === 'progressBox' ? ['hidden'] : []);
    const el = {
      id,
      disabled: false,
      textContent: '',
      className: '',
      style: { width: '' },
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c)
      },
      addEventListener: () => {}
    };
    elements.set(id, el);
    return el;
  };
  ['engineBadge', 'langBadge', 'alertBox', 'toggleTranslateBtn', 'selectSectionBtn', 'translateInputBtn', 'openSettingsBtn', 'progressBox', 'progressBar', 'progressLabel'].forEach(makeEl);

  const popupDoc = { getElementById: id => elements.get(id) || null };
  const popup = await initPopup(popupDoc, {
    storage: {
      sync: {
        get: async (d) => ({ ...d, activeEngine: 'openrouter', openrouterApiKey: '', openrouterModel: 'deepseek/deepseek-chat:free' })
      }
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ isTranslated: false })
    },
    runtime: { onMessage: { addListener: () => {} } }
  });

  assert.ok(popup.engineBadge.textContent.includes('deepseek-chat:free'));
  assert.equal(popup.toggleBtn.disabled, true);
  assert.ok(popup.alertBox.textContent.includes('OpenRouter'));
});
