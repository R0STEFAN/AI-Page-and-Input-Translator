import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  filterAndSortCoarenaModels,
  parseCoarenaResponse,
  buildCoarenaBatchPayload,
  buildCoarenaInputPayload,
  fetchCoarenaModels,
  translateBatchCoarena,
  translateInputCoarena
} from '../background/coarena.js';
import { DEFAULT_SETTINGS } from '../background/storage.js';
import { handleMessage, routeTranslation } from '../background/background.js';
import { updateEngineVisibility } from '../options/options.js';
import { initPopup } from '../popup/popup.js';

test('manifest.json permits https://coarena.ai/* and storage has Coarena defaults', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://coarena.ai/*'));
  assert.equal(DEFAULT_SETTINGS.coarenaApiKey, '');
  assert.equal(DEFAULT_SETTINGS.coarenaModel, 'claude-haiku-5-5');
  assert.ok(Array.isArray(DEFAULT_SETTINGS.coarenaAvailableModels));
  assert.ok(DEFAULT_SETTINGS.coarenaAvailableModels.includes('claude-haiku-5-5'));
});

test('filterAndSortCoarenaModels prioritizes haiku, sonnet, minimax flash', () => {
  const apiData = {
    data: [
      { id: 'qwen3-8-2-4t-a95b', lifecycle: 'active' },
      { id: 'claude-opus-5-5', lifecycle: 'active' },
      { id: 'minimax-m3-1-flash', lifecycle: 'active' },
      { id: 'claude-haiku-5-5', lifecycle: 'active' },
      { id: 'old-model', lifecycle: 'deprecated' }
    ]
  };

  const models = filterAndSortCoarenaModels(apiData);
  assert.equal(models[0], 'claude-haiku-5-5');
  assert.equal(models[1], 'minimax-m3-1-flash');
  assert.equal(models[2], 'claude-opus-5-5');
  assert.ok(!models.includes('old-model'));
});

test('parseCoarenaResponse handles markdown fences and extracts translations', () => {
  const batchPayload = buildCoarenaBatchPayload(['Hello', 'World'], 'Українська', 'claude-haiku-5-5');
  assert.deepEqual(batchPayload.reasoning, { enabled: false });

  const inputPayload = buildCoarenaInputPayload('Draft text', 'English', 'minimax-m3-1-flash');
  assert.deepEqual(inputPayload.reasoning, { enabled: false });

  const fenced = {
    choices: [
      {
        message: {
          content: '```json\n{"translations": ["Привіт", "Світ"]}\n```'
        }
      }
    ]
  };
  assert.deepEqual(parseCoarenaResponse(fenced, 2), ['Привіт', 'Світ']);

  const plainSingle = {
    choices: [{ message: { content: 'Привіт усім!' } }]
  };
  assert.deepEqual(parseCoarenaResponse(plainSingle, 1), ['Привіт усім!']);
});

test('routeTranslation and handleMessage support coarena engine end-to-end', async () => {
  let called = '';
  routeTranslation('coarena', () => { called = 'gemini'; }, () => { called = 'local'; }, () => { called = 'openrouter'; }, () => { called = 'coarena'; });
  assert.equal(called, 'coarena');

  const originalFetch = globalThis.fetch;
  const savedPatches = [];
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'coarena',
          coarenaApiKey: 'coa_test',
          coarenaModel: 'claude-haiku-5-5',
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
            { id: 'claude-haiku-5-5', lifecycle: 'active' },
            { id: 'minimax-m3-1-flash', lifecycle: 'active' }
          ]
        })
      };
    }
    const body = JSON.parse(opts.body);
    if (body.messages[0].content.includes('Draft text')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"translations":["Hello world!"]}' } }] })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"translations":["Переклад"]}' } }] })
    };
  };

  try {
    const modelsRes = await new Promise(resolve => {
      handleMessage({ type: 'FETCH_COARENA_MODELS', payload: { apiKey: 'coa_test' } }, {}, resolve);
    });
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.data.models, ['claude-haiku-5-5', 'minimax-m3-1-flash']);
    assert.ok(savedPatches.some(p => Array.isArray(p.coarenaAvailableModels)));

    const batchRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_BATCH', payload: { texts: ['Original'] } }, {}, resolve);
    });
    assert.equal(batchRes.ok, true);
    assert.deepEqual(batchRes.data.translations, ['Переклад']);

    const inputRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_INPUT', payload: { text: 'Привіт' } }, {}, resolve);
    });
    assert.equal(inputRes.ok, true);
    assert.equal(inputRes.data.translation, 'Hello world!');
  } finally {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  }
});

test('options.html and popup.js integrate Coarena controls and readiness checks', async () => {
  const html = fs.readFileSync(path.resolve('options/options.html'), 'utf8');
  for (const id of ['engineCoarena', 'coarenaSection', 'coarenaApiKey', 'toggleCoarenaApiKey', 'fetchCoarenaModelsBtn', 'coarenaModelSelect']) {
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
  const c = makeSection();
  updateEngineVisibility('coarena', g, l, o, c);
  assert.ok(g.classList.contains('hidden'));
  assert.ok(l.classList.contains('hidden'));
  assert.ok(o.classList.contains('hidden'));
  assert.ok(!c.classList.contains('hidden'));

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
        add: cls => classes.add(cls),
        remove: cls => classes.delete(cls),
        contains: cls => classes.has(cls)
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
        get: async (d) => ({ ...d, activeEngine: 'coarena', coarenaApiKey: '', coarenaModel: 'claude-haiku-5-5' })
      }
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ isTranslated: false })
    },
    runtime: { onMessage: { addListener: () => {} } }
  });

  assert.ok(popup.engineBadge.textContent.includes('claude-haiku-5-5'));
  assert.equal(popup.toggleBtn.disabled, true);
  assert.ok(popup.alertBox.textContent.includes('Coarena'));
});
