import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  filterAndSortOpenCodeModels,
  parseOpenCodeResponse,
  buildOpenCodeBatchPayload,
  buildOpenCodeInputPayload,
  fetchOpenCodeModels,
  translateBatchOpenCode,
  translateInputOpenCode
} from '../background/opencode.js';
import { DEFAULT_SETTINGS } from '../background/storage.js';
import { handleMessage, routeTranslation } from '../background/background.js';
import { updateEngineVisibility } from '../options/options.js';
import { initPopup } from '../popup/popup.js';

test('manifest.json permits https://opencode.ai/* and storage has OpenCode defaults', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('manifest.json'), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://opencode.ai/*'));
  assert.equal(DEFAULT_SETTINGS.opencodeApiKey, '');
  assert.equal(DEFAULT_SETTINGS.opencodeModel, 'nemotron-3.5-lightning-free');
  assert.ok(Array.isArray(DEFAULT_SETTINGS.opencodeAvailableModels));
  assert.ok(DEFAULT_SETTINGS.opencodeAvailableModels.includes('nemotron-3.5-lightning-free'));
});

test('filterAndSortOpenCodeModels puts -free models first and sorts favorites', () => {
  const apiData = {
    data: [
      { id: 'claude-haiku-5-5' },
      { id: 'deepseek-v4.1-flash-free' },
      { id: 'nemotron-3.5-lightning-free' },
      { id: 'minimax-m3.1-flash-free' },
      { id: 'gpt-5.5' }
    ]
  };

  const models = filterAndSortOpenCodeModels(apiData);
  assert.equal(models[0], 'nemotron-3.5-lightning-free');
  assert.equal(models[1], 'minimax-m3.1-flash-free');
  assert.equal(models[2], 'deepseek-v4.1-flash-free');
  assert.ok(models.includes('claude-haiku-5-5'));
});

test('parseOpenCodeResponse extracts translations array and single plain text', () => {
  const jsonResp = {
    choices: [{ message: { content: '```json\n{"translations": ["Пункт 1", "Пункт 2"]}\n```' } }]
  };
  assert.deepEqual(parseOpenCodeResponse(jsonResp, 2), ['Пункт 1', 'Пункт 2']);

  const plainSingle = {
    choices: [{ message: { content: 'Перекладений текст' } }]
  };
  assert.deepEqual(parseOpenCodeResponse(plainSingle, 1), ['Перекладений текст']);
});

test('routeTranslation and handleMessage support opencode engine end-to-end', async () => {
  let called = '';
  routeTranslation('opencode', () => { called = 'gemini'; }, () => { called = 'local'; }, () => { called = 'openrouter'; }, () => { called = 'coarena'; }, () => { called = 'opencode'; });
  assert.equal(called, 'opencode');

  const originalFetch = globalThis.fetch;
  const savedPatches = [];
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'opencode',
          opencodeApiKey: 'oc_sk_test',
          opencodeModel: 'nemotron-3.5-lightning-free',
          targetLanguage: 'Українська',
          inputTargetLanguage: 'English'
        }),
        set: async (patch) => { savedPatches.push(patch); }
      }
    }
  };

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/inference/v1/models')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'nemotron-3.5-lightning-free' },
            { id: 'minimax-m3.1-flash-free' }
          ]
        })
      };
    }
    const body = JSON.parse(opts.body);
    if (body.messages[0].content.includes('Draft text')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"translations":["Fast translation!"]}' } }] })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"translations":["Перекладено успішно"]}' } }] })
    };
  };

  try {
    const modelsRes = await new Promise(resolve => {
      handleMessage({ type: 'FETCH_OPENCODE_MODELS', payload: { apiKey: 'oc_sk_test' } }, {}, resolve);
    });
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.data.models, ['nemotron-3.5-lightning-free', 'minimax-m3.1-flash-free']);
    assert.ok(savedPatches.some(p => Array.isArray(p.opencodeAvailableModels)));

    const batchRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_BATCH', payload: { texts: ['Hello'] } }, {}, resolve);
    });
    assert.equal(batchRes.ok, true);
    assert.deepEqual(batchRes.data.translations, ['Перекладено успішно']);

    const inputRes = await new Promise(resolve => {
      handleMessage({ type: 'TRANSLATE_INPUT', payload: { text: 'Швидкий переклад!' } }, {}, resolve);
    });
    assert.equal(inputRes.ok, true);
    assert.equal(inputRes.data.translation, 'Fast translation!');
  } finally {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  }
});

test('options.html and popup.js integrate OpenCode controls and readiness checks', async () => {
  const html = fs.readFileSync(path.resolve('options/options.html'), 'utf8');
  for (const id of ['engineOpenCode', 'opencodeSection', 'opencodeApiKey', 'toggleOpenCodeApiKey', 'fetchOpenCodeModelsBtn', 'opencodeModelSelect']) {
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
  const r = makeSection();
  const c = makeSection();
  const oc = makeSection();
  updateEngineVisibility('opencode', g, l, r, c, oc);
  assert.ok(g.classList.contains('hidden'));
  assert.ok(l.classList.contains('hidden'));
  assert.ok(r.classList.contains('hidden'));
  assert.ok(c.classList.contains('hidden'));
  assert.ok(!oc.classList.contains('hidden'));

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
        get: async (d) => ({ ...d, activeEngine: 'opencode', opencodeApiKey: '', opencodeModel: 'nemotron-3.5-lightning-free' })
      }
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ isTranslated: false })
    },
    runtime: { onMessage: { addListener: () => {} } }
  });

  assert.ok(popup.engineBadge.textContent.includes('nemotron-3.5-lightning-free'));
  assert.equal(popup.toggleBtn.disabled, true);
  assert.ok(popup.alertBox.textContent.includes('OpenCode'));
});
