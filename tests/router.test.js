import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeTranslation,
  setupContextMenu,
  handleContextMenuClick,
  handleMessage
} from '../background/background.js';
import { DEFAULT_SETTINGS } from '../background/storage.js';

// Plan brief test
function localRouteTranslation(engine, geminiFn, localFn) {
  if (engine === 'local') return localFn();
  return geminiFn();
}

test('routeTranslation selects appropriate engine function', () => {
  let geminiCalled = false;
  let localCalled = false;

  localRouteTranslation('gemini', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, true);
  assert.equal(localCalled, false);

  geminiCalled = false;
  localCalled = false;
  localRouteTranslation('local', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, false);
  assert.equal(localCalled, true);
});

test('exported routeTranslation behaves identically', () => {
  let geminiCalled = false;
  let localCalled = false;

  routeTranslation('gemini', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, true);
  assert.equal(localCalled, false);

  geminiCalled = false;
  localCalled = false;
  routeTranslation('local', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, false);
  assert.equal(localCalled, true);
});

test('setupContextMenu creates context menu with correct options', () => {
  let createdOptions = null;
  globalThis.chrome = {
    contextMenus: {
      create: (opts) => {
        createdOptions = opts;
      }
    }
  };

  try {
    setupContextMenu();
    assert.deepEqual(createdOptions, {
      id: 'ai-translate-selection',
      title: '✨ Перекласти виділене (AI)',
      contexts: ['selection']
    });
  } finally {
    delete globalThis.chrome;
  }
});

test('handleContextMenuClick dispatches TRIGGER_SELECTION_TRANSLATION to tab', async () => {
  let sentMessage = null;
  let targetTabId = null;

  globalThis.chrome = {
    tabs: {
      sendMessage: async (tabId, msg) => {
        targetTabId = tabId;
        sentMessage = msg;
      }
    }
  };

  try {
    await handleContextMenuClick({ menuItemId: 'ai-translate-selection' }, { id: 42 });
    assert.equal(targetTabId, 42);
    assert.deepEqual(sentMessage, { action: 'TRIGGER_SELECTION_TRANSLATION' });

    // Should ignore non-matching menu item
    sentMessage = null;
    targetTabId = null;
    await handleContextMenuClick({ menuItemId: 'other-action' }, { id: 42 });
    assert.equal(sentMessage, null);
    assert.equal(targetTabId, null);

    // Should ignore when tab has no id
    await handleContextMenuClick({ menuItemId: 'ai-translate-selection' }, null);
    assert.equal(sentMessage, null);
  } finally {
    delete globalThis.chrome;
  }
});

test('handleMessage ignores messages destined for offscreen document or empty messages', () => {
  const offscreenResult = handleMessage({ target: 'offscreen', type: 'LOAD_LOCAL_MODEL' }, {}, () => {});
  assert.equal(offscreenResult, false);

  const nullResult = handleMessage(null, {}, () => {});
  assert.equal(nullResult, false);
});

test('handleMessage routes GET_SETTINGS', async () => {
  let responseData = null;
  const keepAlive = handleMessage(
    { type: 'GET_SETTINGS' },
    {},
    (res) => { responseData = res; }
  );
  assert.equal(keepAlive, true);

  // Wait for async handler
  await new Promise(r => setTimeout(r, 20));
  assert.equal(responseData?.ok, true);
  assert.deepEqual(responseData?.data, DEFAULT_SETTINGS);
});

test('handleMessage routes SAVE_SETTINGS', async () => {
  let responseData = null;
  const keepAlive = handleMessage(
    { type: 'SAVE_SETTINGS', payload: { targetLanguage: 'English' } },
    {},
    (res) => { responseData = res; }
  );
  assert.equal(keepAlive, true);

  await new Promise(r => setTimeout(r, 20));
  assert.equal(responseData?.ok, true);
  assert.equal(responseData?.data?.targetLanguage, 'English');
});

test('handleMessage routes FETCH_MODELS', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] }
      ]
    })
  });

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      { type: 'FETCH_MODELS', payload: { apiKey: 'test-api-key' } },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true);
    assert.deepEqual(responseData?.data?.models, ['gemini-2.5-flash', 'gemini-1.5-pro']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handleMessage routes DOWNLOAD_LOCAL_MODEL', async () => {
  let sentToOffscreenMsg = null;
  globalThis.chrome = {
    offscreen: {
      createDocument: async () => true
    },
    runtime: {
      getContexts: async () => [{ contextTypes: ['OFFSCREEN_DOCUMENT'] }],
      sendMessage: (msg, cb) => {
        sentToOffscreenMsg = msg;
        cb({ ok: true, data: { success: true } });
      },
      lastError: null
    }
  };

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      { type: 'DOWNLOAD_LOCAL_MODEL' },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true);
    assert.deepEqual(responseData?.data, { success: true });
    assert.equal(sentToOffscreenMsg?.target, 'offscreen');
    assert.equal(sentToOffscreenMsg?.type, 'LOAD_LOCAL_MODEL');
  } finally {
    delete globalThis.chrome;
  }
});

test('handleMessage routes TRANSLATE_BATCH to Gemini when engine is gemini', async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  let store = { activeEngine: 'gemini', geminiApiKey: 'test-api-key' };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (patch) => { Object.assign(store, patch); }
      }
    }
  };

  globalThis.fetch = async (url, options) => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  translations: ['Привіт', 'Світ']
                })
              }
            ]
          }
        }
      ]
    })
  });

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      {
        type: 'TRANSLATE_BATCH',
        payload: { texts: ['Hello', 'World'], targetLanguage: 'Українська' }
      },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true, responseData?.error);
    assert.deepEqual(responseData?.data?.translations, ['Привіт', 'Світ']);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test('handleMessage routes TRANSLATE_BATCH to Offscreen when engine is local', async () => {
  const originalChrome = globalThis.chrome;
  let store = { activeEngine: 'local' };
  let offscreenReceived = null;

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (patch) => { Object.assign(store, patch); }
      }
    },
    offscreen: {
      createDocument: async () => true
    },
    runtime: {
      getContexts: async () => [{ contextTypes: ['OFFSCREEN_DOCUMENT'] }],
      sendMessage: (msg, cb) => {
        offscreenReceived = msg;
        cb({ ok: true, data: { translations: ['Привіт локально', 'Світ локально'] } });
      },
      lastError: null
    }
  };

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      {
        type: 'TRANSLATE_BATCH',
        payload: { texts: ['Hello local', 'World local'], targetLanguage: 'Українська' }
      },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true, responseData?.error);
    assert.deepEqual(responseData?.data?.translations, ['Привіт локально', 'Світ локально']);
    assert.equal(offscreenReceived?.type, 'TRANSLATE_LOCAL_BATCH');
    assert.equal(offscreenReceived?.target, 'offscreen');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('handleMessage routes TRANSLATE_SELECTION to Gemini when engine is gemini', async () => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  let store = { activeEngine: 'gemini', geminiApiKey: 'test-api-key' };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (patch) => { Object.assign(store, patch); }
      }
    }
  };

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  translations: ['Виділений текст перекладено']
                })
              }
            ]
          }
        }
      ]
    })
  });

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      {
        type: 'TRANSLATE_SELECTION',
        payload: { text: 'Selected text', targetLanguage: 'Українська' }
      },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true, responseData?.error);
    assert.deepEqual(responseData?.data, { translation: 'Виділений текст перекладено' });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test('handleMessage routes TRANSLATE_SELECTION to Offscreen when engine is local', async () => {
  const originalChrome = globalThis.chrome;
  let store = { activeEngine: 'local' };
  let offscreenReceived = null;

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (patch) => { Object.assign(store, patch); }
      }
    },
    offscreen: {
      createDocument: async () => true
    },
    runtime: {
      getContexts: async () => [{ contextTypes: ['OFFSCREEN_DOCUMENT'] }],
      sendMessage: (msg, cb) => {
        offscreenReceived = msg;
        cb({ ok: true, data: { translations: ['Локальний переклад виділення'] } });
      },
      lastError: null
    }
  };

  try {
    let responseData = null;
    const keepAlive = handleMessage(
      {
        type: 'TRANSLATE_SELECTION',
        payload: { text: 'Selected text local', targetLanguage: 'Українська' }
      },
      {},
      (res) => { responseData = res; }
    );
    assert.equal(keepAlive, true);

    await new Promise(r => setTimeout(r, 20));
    assert.equal(responseData?.ok, true, responseData?.error);
    assert.deepEqual(responseData?.data, { translation: 'Локальний переклад виділення' });
    assert.equal(offscreenReceived?.type, 'TRANSLATE_LOCAL_BATCH');
    assert.deepEqual(offscreenReceived?.payload?.texts, ['Selected text local']);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('handleMessage returns error for unknown message type', async () => {
  let responseData = null;
  const keepAlive = handleMessage(
    { type: 'UNKNOWN_ACTION_TEST' },
    {},
    (res) => { responseData = res; }
  );
  assert.equal(keepAlive, true);

  await new Promise(r => setTimeout(r, 20));
  assert.equal(responseData?.ok, false);
  assert.match(responseData?.error, /Unknown message type/);
});
