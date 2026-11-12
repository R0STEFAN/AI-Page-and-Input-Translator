import { getSettings, saveSettings } from './storage.js';
import { fetchGeminiModels, translateBatchGemini, translateSingleGemini } from './gemini.js';
import { ensureOffscreenDocument, sendToOffscreen } from './offscreen-manager.js';

export function routeTranslation(engine, geminiFn, localFn) {
  if (engine === 'local') return localFn();
  return geminiFn();
}

// Setup Context Menu on install
export function setupContextMenu(callback) {
  if (typeof chrome !== 'undefined' && chrome.contextMenus) {
    const createMenu = () => {
      if (chrome.contextMenus.create) {
        chrome.contextMenus.create({
          id: 'ai-translate-selection',
          title: '✨ Перекласти виділене (AI)',
          contexts: ['selection']
        }, () => {
          if (chrome.runtime?.lastError) {
            // Ignore potential duplicate or runtime warning
          }
          if (callback) callback();
        });
      }
    };

    if (typeof chrome.contextMenus.removeAll === 'function') {
      chrome.contextMenus.removeAll(() => {
        createMenu();
      });
    } else {
      createMenu();
    }
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenu();
  });
}

// Handle Context Menu clicks
export async function handleContextMenuClick(info, tab) {
  if (info?.menuItemId === 'ai-translate-selection' && tab?.id) {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
        await chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_SELECTION_TRANSLATION' });
      }
    } catch (err) {
      console.warn('Could not send message to tab:', err.message);
    }
  }
}

if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}

// Main Message Router
export function handleMessage(message, sender, sendResponse) {
  // Ignore null messages or messages destined for offscreen document
  if (!message || message.target === 'offscreen') return false;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ ok: true, data: settings });
          break;
        }

        case 'SAVE_SETTINGS': {
          const updated = await saveSettings(message.payload);
          sendResponse({ ok: true, data: updated });
          break;
        }

        case 'FETCH_MODELS': {
          const apiKey = message.payload?.apiKey;
          const models = await fetchGeminiModels(apiKey);
          await saveSettings({ geminiAvailableModels: models });
          sendResponse({ ok: true, data: { models } });
          break;
        }

        case 'DOWNLOAD_LOCAL_MODEL': {
          await ensureOffscreenDocument();
          const res = await sendToOffscreen({ target: 'offscreen', type: 'LOAD_LOCAL_MODEL' });
          await saveSettings({ localModelLoaded: true });
          sendResponse({ ok: true, data: res });
          break;
        }

        case 'TRANSLATE_BATCH': {
          const settings = await getSettings();
          const { texts } = message.payload || {};
          const targetLang = message.payload?.targetLanguage || settings.targetLanguage;

          if (settings.activeEngine === 'local') {
            const res = await sendToOffscreen({
              target: 'offscreen',
              type: 'TRANSLATE_LOCAL_BATCH',
              payload: { texts, targetLanguage: targetLang }
            });
            sendResponse({ ok: true, data: res });
          } else {
            const translations = await translateBatchGemini(
              texts,
              targetLang,
              settings.geminiModel,
              settings.geminiApiKey
            );
            sendResponse({ ok: true, data: { translations } });
          }
          break;
        }

        case 'TRANSLATE_SELECTION': {
          const settings = await getSettings();
          const { text } = message.payload || {};
          const targetLang = message.payload?.targetLanguage || settings.targetLanguage;

          if (settings.activeEngine === 'local') {
            const res = await sendToOffscreen({
              target: 'offscreen',
              type: 'TRANSLATE_LOCAL_BATCH',
              payload: { texts: [text], targetLanguage: targetLang }
            });
            sendResponse({ ok: true, data: { translation: res?.translations?.[0] || text } });
          } else {
            const translation = await translateSingleGemini(
              text,
              targetLang,
              settings.geminiModel,
              settings.geminiApiKey
            );
            sendResponse({ ok: true, data: { translation } });
          }
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
}
