import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { updateButtonState, initPopup } from '../popup/popup.js';

test('popup files exist', () => {
  assert.ok(fs.existsSync(path.resolve('popup/popup.html')), 'popup.html must exist');
  assert.ok(fs.existsSync(path.resolve('popup/popup.css')), 'popup.css must exist');
  assert.ok(fs.existsSync(path.resolve('popup/popup.js')), 'popup.js must exist');
});

test('popup.html contains all required IDs, scripts, styles, and elements', () => {
  const html = fs.readFileSync(path.resolve('popup/popup.html'), 'utf8');

  // Verify stylesheet and script
  assert.ok(html.includes('href="popup.css"'), 'Should link to popup.css');
  assert.ok(html.includes('src="popup.js"'), 'Should link to popup.js');
  assert.ok(html.includes('type="module"'), 'Script should be type="module"');

  // Verify all required IDs
  const requiredIds = [
    'engineBadge',
    'langBadge',
    'alertBox',
    'toggleTranslateBtn',
    'openSettingsBtn',
    'progressBox',
    'progressBar',
    'progressLabel'
  ];

  for (const id of requiredIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `popup.html must contain element with id="${id}"`
    );
  }

  // Verify icon and title
  assert.ok(html.includes('AI Translator'), 'Must have brand title "AI Translator"');
  assert.ok(html.includes('icon32.png'), 'Must reference icon32.png');
});

test('popup.css contains necessary layout and utility rules', () => {
  const css = fs.readFileSync(path.resolve('popup/popup.css'), 'utf8');
  assert.ok(css.includes('.popup-container') || css.includes('body'), 'Must have container or body styling');
  assert.ok(css.includes('.popup-header'), 'Must have .popup-header class');
  assert.ok(css.includes('.brand'), 'Must have .brand class');
  assert.ok(css.includes('.info-badges'), 'Must have .info-badges class');
  assert.ok(css.includes('.info-pill'), 'Must have .info-pill class');
  assert.ok(css.includes('.alert-box'), 'Must have .alert-box class');
  assert.ok(css.includes('.hidden'), 'Must have .hidden utility');
  assert.ok(css.includes('.btn-primary'), 'Must have .btn-primary class');
  assert.ok(css.includes('.btn-restore'), 'Must have .btn-restore class');
  assert.ok(css.includes('.progress-box'), 'Must have .progress-box class');
  assert.ok(css.includes('.progress-bar-bg'), 'Must have .progress-bar-bg class');
  assert.ok(css.includes('.progress-bar-fill'), 'Must have .progress-bar-fill class');
  assert.ok(css.includes('.progress-label'), 'Must have .progress-label class');
});

test('updateButtonState toggles button label and classes correctly', () => {
  const btn = { textContent: '', className: '' };

  // Translated state
  updateButtonState(btn, true);
  assert.equal(btn.textContent, '↺ Повернути оригінал');
  assert.equal(btn.className, 'btn btn-restore');

  // Original untranslated state
  updateButtonState(btn, false);
  assert.equal(btn.textContent, '🌐 Перекласти сторінку');
  assert.equal(btn.className, 'btn btn-primary');

  // Handles null safely
  assert.doesNotThrow(() => updateButtonState(null, true));
});

// Helper to create a simulated DOM tree for popup.js testing
function createMockPopupDoc() {
  const elements = new Map();

  function makeEl(id, tagName = 'div', extra = {}) {
    const classes = new Set(extra.classes || []);
    const listeners = {};
    const el = {
      id,
      tagName,
      disabled: extra.disabled || false,
      textContent: extra.textContent || '',
      className: extra.className || '',
      style: { width: '' },
      classList: {
        add: (c) => {
          classes.add(c);
          el.className = Array.from(classes).join(' ');
        },
        remove: (c) => {
          classes.delete(c);
          el.className = Array.from(classes).join(' ');
        },
        contains: (c) => classes.has(c)
      },
      addEventListener: (event, handler) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
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

  makeEl('engineBadge', 'span');
  makeEl('langBadge', 'span');
  makeEl('alertBox', 'div', { classes: ['hidden'] });
  makeEl('toggleTranslateBtn', 'button', { className: 'btn btn-primary' });
  makeEl('openSettingsBtn', 'button');
  makeEl('progressBox', 'div', { classes: ['hidden'] });
  makeEl('progressBar', 'div');
  makeEl('progressLabel', 'div');

  return {
    getElementById: (id) => elements.get(id) || null,
    elements
  };
}

test('initPopup returns early if no active tab exists', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => []
    },
    runtime: {
      sendMessage: async () => ({ ok: true, data: {} }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.ok(res);
  assert.equal(res.tab, null);
});

test('initPopup sets engine and language badges correctly for Gemini', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 101 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            ok: true,
            data: {
              activeEngine: 'gemini',
              geminiModel: 'gemini-1.5-pro',
              geminiApiKey: 'test-key',
              targetLanguage: 'Polski'
            }
          };
        }
        return { ok: true };
      },
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.engineBadge.textContent, '🌐 gemini-1.5-pro');
  assert.equal(res.langBadge.textContent, 'Polski');
  assert.ok(res.alertBox.classList.contains('hidden'));
  assert.equal(res.toggleBtn.disabled, false);
});

test('initPopup sets engine badge correctly for Local WebGPU engine', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 102 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            ok: true,
            data: {
              activeEngine: 'local',
              localModelLoaded: true,
              targetLanguage: 'Українська'
            }
          };
        }
        return { ok: true };
      },
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.engineBadge.textContent, '⚡ Офлайн (WebGPU)');
  assert.equal(res.langBadge.textContent, 'Українська');
  assert.ok(res.alertBox.classList.contains('hidden'));
  assert.equal(res.toggleBtn.disabled, false);
});

test('initPopup displays warning alert and disables button when Gemini API key is missing', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 103 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            ok: true,
            data: {
              activeEngine: 'gemini',
              geminiApiKey: ''
            }
          };
        }
        return { ok: true };
      },
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.alertBox.textContent, 'Вкажіть API ключ у налаштуваннях');
  assert.ok(!res.alertBox.classList.contains('hidden'));
  assert.equal(res.toggleBtn.disabled, true);
});

test('initPopup displays warning alert and disables button when Local model is not loaded', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 104 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'GET_SETTINGS') {
          return {
            ok: true,
            data: {
              activeEngine: 'local',
              localModelLoaded: false
            }
          };
        }
        return { ok: true };
      },
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.alertBox.textContent, 'Завантажте офлайн модель у налаштуваннях');
  assert.ok(!res.alertBox.classList.contains('hidden'));
  assert.equal(res.toggleBtn.disabled, true);
});

test('initPopup detects page already translated and updates button to restore', async () => {
  const doc = createMockPopupDoc();
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 105 }],
      sendMessage: async (tabId, msg) => {
        if (msg.action === 'GET_PAGE_STATUS') {
          return { ok: true, isTranslated: true };
        }
        return { ok: true };
      }
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.getIsTranslated(), true);
  assert.equal(res.toggleBtn.textContent, '↺ Повернути оригінал');
  assert.equal(res.toggleBtn.className, 'btn btn-restore');
});

test('openSettingsBtn calls chrome.runtime.openOptionsPage', async () => {
  const doc = createMockPopupDoc();
  let optionsPageOpened = false;

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 106 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      openOptionsPage: () => {
        optionsPageOpened = true;
      },
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  await res.openSettingsBtn.dispatchEvent('click');
  assert.equal(optionsPageOpened, true);
});

test('progress listener updates progress bar and label upon PAGE_TRANSLATION_PROGRESS message', async () => {
  const doc = createMockPopupDoc();
  let messageCallback = null;

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 107 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: {
        addListener: (cb) => {
          messageCallback = cb;
        }
      }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.ok(messageCallback);

  // Dispatch progress message
  messageCallback({
    type: 'PAGE_TRANSLATION_PROGRESS',
    done: 6,
    total: 10
  });

  assert.ok(!res.progressBox.classList.contains('hidden'));
  assert.equal(res.progressBar.style.width, '60%');
  assert.equal(res.progressLabel.textContent, 'Перекладено: 6 з 10 блоків');
});

test('toggleTranslateBtn triggers translation when not translated and handles success', async () => {
  const doc = createMockPopupDoc();
  const sentTabMessages = [];

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 108 }],
      sendMessage: async (tabId, msg) => {
        sentTabMessages.push({ tabId, msg });
        if (msg.action === 'GET_PAGE_STATUS') {
          return { ok: true, isTranslated: false };
        }
        if (msg.action === 'TRANSLATE_MAIN_CONTENT') {
          return { ok: true };
        }
        return { ok: true };
      }
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.getIsTranslated(), false);

  // Click translate button
  await res.toggleBtn.dispatchEvent('click');

  // Verify TRANSLATE_MAIN_CONTENT was sent
  const translateMsg = sentTabMessages.find(m => m.msg.action === 'TRANSLATE_MAIN_CONTENT');
  assert.ok(translateMsg);
  assert.equal(translateMsg.tabId, 108);

  // State should now be translated
  assert.equal(res.getIsTranslated(), true);
  assert.equal(res.toggleBtn.textContent, '↺ Повернути оригінал');
  assert.equal(res.toggleBtn.className, 'btn btn-restore');
  assert.equal(res.toggleBtn.disabled, false);
  assert.ok(res.progressBox.classList.contains('hidden'));
});

test('toggleTranslateBtn handles translation failure gracefully and alerts error', async () => {
  const doc = createMockPopupDoc();
  let alertedError = '';

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 109 }],
      sendMessage: async (tabId, msg) => {
        if (msg.action === 'GET_PAGE_STATUS') {
          return { ok: true, isTranslated: false };
        }
        if (msg.action === 'TRANSLATE_MAIN_CONTENT') {
          return { ok: false, error: 'Rate limit exceeded' };
        }
        return { ok: true };
      }
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi, (err) => {
    alertedError = err;
  });

  await res.toggleBtn.dispatchEvent('click');

  assert.ok(alertedError.includes('Rate limit exceeded'), `Alert should mention error, got: ${alertedError}`);
  assert.equal(res.getIsTranslated(), false);
  assert.equal(res.toggleBtn.textContent, '🌐 Перекласти сторінку');
  assert.equal(res.toggleBtn.disabled, false);
  assert.ok(res.progressBox.classList.contains('hidden'));
});

test('toggleTranslateBtn triggers restore when translated and handles success', async () => {
  const doc = createMockPopupDoc();
  const sentTabMessages = [];

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 110 }],
      sendMessage: async (tabId, msg) => {
        sentTabMessages.push({ tabId, msg });
        if (msg.action === 'GET_PAGE_STATUS') {
          return { ok: true, isTranslated: true };
        }
        if (msg.action === 'RESTORE_ORIGINAL_CONTENT') {
          return { ok: true };
        }
        return { ok: true };
      }
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(res.getIsTranslated(), true);

  // Click restore button
  await res.toggleBtn.dispatchEvent('click');

  // Verify RESTORE_ORIGINAL_CONTENT was sent
  const restoreMsg = sentTabMessages.find(m => m.msg.action === 'RESTORE_ORIGINAL_CONTENT');
  assert.ok(restoreMsg);
  assert.equal(restoreMsg.tabId, 110);

  // State should now be original untranslated
  assert.equal(res.getIsTranslated(), false);
  assert.equal(res.toggleBtn.textContent, '🌐 Перекласти сторінку');
  assert.equal(res.toggleBtn.className, 'btn btn-primary');
  assert.equal(res.toggleBtn.disabled, false);
  assert.ok(res.progressBox.classList.contains('hidden'));
});

test('toggleTranslateBtn handles restore failure gracefully and alerts error', async () => {
  const doc = createMockPopupDoc();
  let alertedError = '';

  const chromeApi = {
    tabs: {
      query: async () => [{ id: 111 }],
      sendMessage: async (tabId, msg) => {
        if (msg.action === 'GET_PAGE_STATUS') {
          return { ok: true, isTranslated: true };
        }
        if (msg.action === 'RESTORE_ORIGINAL_CONTENT') {
          throw new Error('Tab crashed');
        }
        return { ok: true };
      }
    },
    runtime: {
      sendMessage: async () => ({
        ok: true,
        data: { activeEngine: 'gemini', geminiApiKey: 'valid-key' }
      }),
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi, (err) => {
    alertedError = err;
  });

  await res.toggleBtn.dispatchEvent('click');

  assert.ok(alertedError.includes('Tab crashed'), `Alert should mention error, got: ${alertedError}`);
  assert.equal(res.getIsTranslated(), true); // Remains in previous state
  assert.equal(res.toggleBtn.disabled, false);
  assert.ok(res.progressBox.classList.contains('hidden'));
});

test('initPopup reads chrome.storage.sync directly without waking background SW via GET_SETTINGS', async () => {
  const doc = createMockPopupDoc();
  let swSettingsCalls = 0;

  const chromeApi = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'gemini',
          geminiApiKey: 'direct-key',
          geminiModel: 'gemini-2.5-flash',
          targetLanguage: 'Українська',
          inputTargetLanguage: 'English'
        })
      }
    },
    tabs: {
      query: async () => [{ id: 12 }],
      sendMessage: async () => ({ ok: true, isTranslated: false })
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'GET_SETTINGS') swSettingsCalls += 1;
        return {};
      },
      onMessage: { addListener: () => {} }
    }
  };

  const res = await initPopup(doc, chromeApi);
  assert.equal(swSettingsCalls, 0, 'Should skip GET_SETTINGS message when chrome.storage is available');
  assert.ok(res.engineBadge.textContent.includes('gemini-2.5-flash'));
});
