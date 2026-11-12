import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { updateEngineVisibility, initOptions } from '../options/options.js';

test('options files exist', () => {
  assert.ok(fs.existsSync(path.resolve('options/options.html')), 'options.html must exist');
  assert.ok(fs.existsSync(path.resolve('options/options.css')), 'options.css must exist');
  assert.ok(fs.existsSync(path.resolve('options/options.js')), 'options.js must exist');
});

test('options.html contains all required IDs, scripts, styles, and options', () => {
  const html = fs.readFileSync(path.resolve('options/options.html'), 'utf8');

  // Verify stylesheet and script
  assert.ok(html.includes('href="options.css"'), 'Should link to options.css');
  assert.ok(html.includes('src="options.js"'), 'Should link to options.js');
  assert.ok(html.includes('type="module"'), 'Script should be type="module"');

  // Verify all required IDs
  const requiredIds = [
    'engineGemini',
    'engineLocal',
    'geminiSection',
    'localSection',
    'apiKey',
    'toggleApiKey',
    'fetchModelsBtn',
    'modelSelect',
    'targetLanguage',
    'downloadModelBtn',
    'modelStatusBadge',
    'progressContainer',
    'progressBar',
    'progressText',
    'saveBtn',
    'saveStatus'
  ];

  for (const id of requiredIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `options.html must contain element with id="${id}"`
    );
  }

  // Radio button checks
  assert.ok(html.includes('name="engine"'), 'Must have radio inputs with name="engine"');
  assert.ok(html.includes('value="gemini"'), 'Must have engine value="gemini"');
  assert.ok(html.includes('value="local"'), 'Must have engine value="local"');

  // Target languages
  const languages = ['Українська', 'English', 'Polski', 'Deutsch', 'Español', 'Français'];
  for (const lang of languages) {
    assert.ok(
      html.includes(`value="${lang}"`),
      `options.html must include option for language "${lang}"`
    );
  }

  // Gemini model options
  assert.ok(html.includes('value="gemini-2.5-flash"'), 'Must have gemini-2.5-flash option');
  assert.ok(html.includes('value="gemini-1.5-flash"'), 'Must have gemini-1.5-flash option');
  assert.ok(html.includes('value="gemini-1.5-pro"'), 'Must have gemini-1.5-pro option');
});

test('options.css contains necessary layout and utility rules', () => {
  const css = fs.readFileSync(path.resolve('options/options.css'), 'utf8');
  assert.ok(css.includes('.container'), 'Must have .container class');
  assert.ok(css.includes('.engine-tabs'), 'Must have .engine-tabs class');
  assert.ok(css.includes('.hidden'), 'Must have .hidden utility');
  assert.ok(css.includes('.progress-bar'), 'Must have .progress-bar class');
  assert.ok(css.includes('.badge.ready'), 'Must have .badge.ready class');
});

test('updateEngineVisibility toggles .hidden class correctly', () => {
  const createMockElement = () => {
    const classes = new Set();
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c)
      }
    };
  };

  const geminiSection = createMockElement();
  const localSection = createMockElement();
  localSection.classList.add('hidden');

  // Switch to local
  updateEngineVisibility('local', geminiSection, localSection);
  assert.ok(geminiSection.classList.contains('hidden'));
  assert.ok(!localSection.classList.contains('hidden'));

  // Switch to gemini
  updateEngineVisibility('gemini', geminiSection, localSection);
  assert.ok(!geminiSection.classList.contains('hidden'));
  assert.ok(localSection.classList.contains('hidden'));
});

// Helper to create a simulated DOM tree for options.js unit testing
function createMockOptionsDoc() {
  const elements = new Map();

  function makeEl(id, tagName = 'div', extra = {}) {
    const classes = new Set(extra.classes || []);
    const listeners = {};
    const el = {
      id,
      tagName,
      value: extra.value || '',
      type: extra.type || 'text',
      checked: extra.checked || false,
      disabled: false,
      textContent: extra.textContent || '',
      innerHTML: extra.innerHTML || '',
      style: { width: '', color: '' },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c)
      },
      addEventListener: (event, handler) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: (event, handler) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(h => h !== handler);
        }
      },
      dispatchEvent: async (event, eventObj = {}) => {
        if (listeners[event]) {
          for (const handler of listeners[event]) {
            await handler(eventObj);
          }
        }
      }
    };
    elements.set(id, el);
    return el;
  }

  makeEl('engineGemini', 'input', { type: 'radio', checked: true });
  makeEl('engineLocal', 'input', { type: 'radio', checked: false });
  makeEl('geminiSection', 'section');
  makeEl('localSection', 'section', { classes: ['hidden'] });
  makeEl('apiKey', 'input', { type: 'password', value: '' });
  makeEl('toggleApiKey', 'button');
  makeEl('fetchModelsBtn', 'button');
  makeEl('modelSelect', 'select');
  makeEl('targetLanguage', 'select', { value: 'Українська' });
  makeEl('downloadModelBtn', 'button');
  makeEl('modelStatusBadge', 'span');
  makeEl('progressContainer', 'div', { classes: ['hidden'] });
  makeEl('progressBar', 'div');
  makeEl('progressText', 'span');
  makeEl('saveBtn', 'button');
  makeEl('saveStatus', 'span');

  return {
    getElementById: (id) => elements.get(id) || null
  };
}

test('initOptions loads settings and binds UI interactions', async () => {
  const doc = createMockOptionsDoc();
  const sentMessages = [];
  const messageListeners = [];

  const mockChrome = {
    runtime: {
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          return {
            ok: true,
            data: {
              activeEngine: 'local',
              geminiApiKey: 'test-key-123',
              geminiModel: 'gemini-1.5-pro',
              geminiAvailableModels: ['gemini-2.5-flash', 'gemini-1.5-pro'],
              targetLanguage: 'Polski',
              localModelLoaded: true
            }
          };
        }
        if (msg.type === 'FETCH_MODELS') {
          return {
            ok: true,
            data: { models: ['gemini-2.5-flash', 'gemini-2.5-pro'] }
          };
        }
        if (msg.type === 'DOWNLOAD_LOCAL_MODEL') {
          return { ok: true, data: { status: 'ready' } };
        }
        if (msg.type === 'SAVE_SETTINGS') {
          return { ok: true, data: msg.payload };
        }
        return { ok: false, error: 'Unknown message' };
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
        removeListener: (fn) => {
          const idx = messageListeners.indexOf(fn);
          if (idx !== -1) messageListeners.splice(idx, 1);
        }
      }
    }
  };

  const alerts = [];
  const alertFn = (msg) => alerts.push(msg);

  await initOptions(doc, mockChrome, alertFn);

  // 1. Initial settings populated
  assert.equal(doc.getElementById('engineLocal').checked, true);
  assert.ok(!doc.getElementById('localSection').classList.contains('hidden'));
  assert.ok(doc.getElementById('geminiSection').classList.contains('hidden'));
  assert.equal(doc.getElementById('apiKey').value, 'test-key-123');
  assert.equal(doc.getElementById('targetLanguage').value, 'Polski');
  assert.ok(doc.getElementById('modelSelect').innerHTML.includes('gemini-1.5-pro'));
  assert.equal(doc.getElementById('modelStatusBadge').textContent, 'Завантажено і готово');
  assert.equal(doc.getElementById('downloadModelBtn').textContent, 'Оновити модель');

  // 2. Toggle API Key visibility
  const apiKeyEl = doc.getElementById('apiKey');
  const toggleBtn = doc.getElementById('toggleApiKey');
  assert.equal(apiKeyEl.type, 'password');
  await toggleBtn.dispatchEvent('click');
  assert.equal(apiKeyEl.type, 'text');
  await toggleBtn.dispatchEvent('click');
  assert.equal(apiKeyEl.type, 'password');

  // 3. Engine switch to gemini
  const engineGemini = doc.getElementById('engineGemini');
  await engineGemini.dispatchEvent('change');
  assert.ok(!doc.getElementById('geminiSection').classList.contains('hidden'));
  assert.ok(doc.getElementById('localSection').classList.contains('hidden'));

  // 4. Fetch models click
  const fetchBtn = doc.getElementById('fetchModelsBtn');
  await fetchBtn.dispatchEvent('click');
  assert.ok(doc.getElementById('modelSelect').innerHTML.includes('gemini-2.5-pro'));
  assert.equal(doc.getElementById('saveStatus').textContent, 'Моделі успішно оновлено!');

  // 5. Download local model click and progress simulation
  const downloadBtn = doc.getElementById('downloadModelBtn');
  const downloadPromise = downloadBtn.dispatchEvent('click');
  // Trigger simulated progress listener while download is active
  for (const listener of messageListeners) {
    listener({ type: 'LOCAL_MODEL_DOWNLOAD_PROGRESS', progress: 50 });
  }
  assert.equal(doc.getElementById('progressBar').style.width, '50%');
  assert.equal(doc.getElementById('progressText').textContent, '50%');

  await downloadPromise;
  assert.equal(doc.getElementById('modelStatusBadge').textContent, 'Завантажено і готово');
  assert.equal(doc.getElementById('progressBar').style.width, '100%');
  assert.equal(doc.getElementById('progressText').textContent, 'Готово!');

  // 6. Save settings click
  const saveBtn = doc.getElementById('saveBtn');
  doc.getElementById('targetLanguage').value = 'Français';
  doc.getElementById('modelSelect').value = 'gemini-2.5-flash';
  await saveBtn.dispatchEvent('click');

  const lastSaveMsg = sentMessages.find(m => m.type === 'SAVE_SETTINGS');
  assert.ok(lastSaveMsg);
  assert.equal(lastSaveMsg.payload.targetLanguage, 'Français');
  assert.equal(doc.getElementById('saveStatus').textContent, 'Налаштування збережено!');
});

test('initOptions alerts if apiKey is empty when fetching models', async () => {
  const doc = createMockOptionsDoc();
  const alerts = [];
  const mockChrome = {
    runtime: {
      sendMessage: async () => ({ ok: true, data: {} })
    }
  };

  await initOptions(doc, mockChrome, (msg) => alerts.push(msg));
  doc.getElementById('apiKey').value = '   ';
  await doc.getElementById('fetchModelsBtn').dispatchEvent('click');

  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes('API ключ'));
});
