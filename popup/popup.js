import { DEFAULT_SETTINGS } from '../background/storage.js';

export function updateButtonState(toggleBtn, translated) {
  if (!toggleBtn) return;
  if (translated) {
    toggleBtn.textContent = '↺ Повернути оригінал';
    toggleBtn.className = 'btn btn-restore';
  } else {
    toggleBtn.textContent = '🌐 Перекласти сторінку';
    toggleBtn.className = 'btn btn-primary';
  }
}

export async function initPopup(
  doc = typeof document !== 'undefined' ? document : null,
  chromeApi = typeof chrome !== 'undefined' ? chrome : null,
  alertFn = typeof alert !== 'undefined' ? alert : console.error
) {
  if (!doc) return null;

  const engineBadge = doc.getElementById('engineBadge');
  const langBadge = doc.getElementById('langBadge');
  const alertBox = doc.getElementById('alertBox');
  const toggleBtn = doc.getElementById('toggleTranslateBtn');
  const selectSectionBtn = doc.getElementById('selectSectionBtn');
  const translateInputBtn = doc.getElementById('translateInputBtn');
  const openSettingsBtn = doc.getElementById('openSettingsBtn');
  const progressBox = doc.getElementById('progressBox');
  const progressBar = doc.getElementById('progressBar');
  const progressLabel = doc.getElementById('progressLabel');

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      if (chromeApi?.runtime?.openOptionsPage) {
        chromeApi.runtime.openOptionsPage();
      }
    });
  }

  // Query active tab, check page status, and read storage directly in parallel (skips SW cold start)
  const tabsPromise = chromeApi?.tabs?.query
    ? Promise.resolve(chromeApi.tabs.query({ active: true, currentWindow: true })).catch(err => {
        console.warn('Failed to query active tab:', err);
        return [];
      })
    : Promise.resolve([]);

  const pageStatusPromise = tabsPromise.then(async (tabs) => {
    const tab = tabs?.[0] || null;
    if (!tab?.id || !chromeApi?.tabs?.sendMessage) return false;
    try {
      const pageStatus = await chromeApi.tabs.sendMessage(tab.id, { action: 'GET_PAGE_STATUS' });
      return Boolean(pageStatus?.isTranslated);
    } catch {
      return false;
    }
  });

  const storageArea = chromeApi?.storage?.sync || chromeApi?.storage?.local;
  const settingsPromise = typeof storageArea?.get === 'function'
    ? Promise.resolve(storageArea.get(DEFAULT_SETTINGS))
        .then(data => ({ data: { ...DEFAULT_SETTINGS, ...(data || {}) } }))
        .catch(err => {
          console.warn('Failed to read storage settings:', err);
          return { data: { ...DEFAULT_SETTINGS } };
        })
    : chromeApi?.runtime?.sendMessage
      ? Promise.resolve(chromeApi.runtime.sendMessage({ type: 'GET_SETTINGS' })).catch(err => {
          console.warn('Failed to get settings:', err);
          return {};
        })
      : Promise.resolve({});

  const [tabs, settingsRes] = await Promise.all([tabsPromise, settingsPromise]);
  const tab = tabs?.[0] || null;

  if (!tab?.id) {
    return {
      engineBadge,
      langBadge,
      alertBox,
      toggleBtn,
      selectSectionBtn,
      translateInputBtn,
      openSettingsBtn,
      progressBox,
      progressBar,
      progressLabel,
      tab: null
    };
  }

  const settings = settingsRes?.data || {};

  if (engineBadge) {
    if (settings.activeEngine === 'local') {
      engineBadge.textContent = '⚡ Офлайн (WebGPU)';
    } else if (settings.activeEngine === 'coarena') {
      const shortName = (settings.coarenaModel || 'claude-haiku-5-5').split('/').pop();
      engineBadge.textContent = `⚡ ${shortName}`;
    } else if (settings.activeEngine === 'openrouter') {
      const shortName = (settings.openrouterModel || 'openrouter/free').split('/').pop();
      engineBadge.textContent = `🚀 ${shortName}`;
    } else {
      engineBadge.textContent = `🌐 ${settings.geminiModel || 'Gemini'}`;
    }
  }
  if (langBadge) {
    langBadge.textContent = settings.targetLanguage || 'Українська';
  }
  if (translateInputBtn) {
    const inputLang = settings.inputTargetLanguage || 'English';
    translateInputBtn.textContent = `✏️ Перекласти input (→ ${inputLang})`;
  }

  // Check readiness
  if (settings.activeEngine === 'gemini' && !settings.geminiApiKey) {
    if (alertBox) {
      alertBox.textContent = 'Вкажіть API ключ у налаштуваннях';
      alertBox.classList.remove('hidden');
    }
    if (toggleBtn) {
      toggleBtn.disabled = true;
    }
    if (selectSectionBtn) {
      selectSectionBtn.disabled = true;
    }
    if (translateInputBtn) {
      translateInputBtn.disabled = true;
    }
  } else if (settings.activeEngine === 'coarena' && !settings.coarenaApiKey) {
    if (alertBox) {
      alertBox.textContent = 'Вкажіть Coarena API ключ у налаштуваннях';
      alertBox.classList.remove('hidden');
    }
    if (toggleBtn) {
      toggleBtn.disabled = true;
    }
    if (selectSectionBtn) {
      selectSectionBtn.disabled = true;
    }
    if (translateInputBtn) {
      translateInputBtn.disabled = true;
    }
  } else if (settings.activeEngine === 'openrouter' && !settings.openrouterApiKey) {
    if (alertBox) {
      alertBox.textContent = 'Вкажіть OpenRouter API ключ у налаштуваннях';
      alertBox.classList.remove('hidden');
    }
    if (toggleBtn) {
      toggleBtn.disabled = true;
    }
    if (selectSectionBtn) {
      selectSectionBtn.disabled = true;
    }
    if (translateInputBtn) {
      translateInputBtn.disabled = true;
    }
  } else if (settings.activeEngine === 'local' && !settings.localModelLoaded) {
    if (alertBox) {
      alertBox.textContent = 'Завантажте офлайн модель у налаштуваннях';
      alertBox.classList.remove('hidden');
    }
    if (toggleBtn) {
      toggleBtn.disabled = true;
    }
    if (selectSectionBtn) {
      selectSectionBtn.disabled = true;
    }
    if (translateInputBtn) {
      translateInputBtn.disabled = true;
    }
  }

  let isTranslated = false;
  function setButtonState(translated) {
    isTranslated = translated;
    updateButtonState(toggleBtn, isTranslated);
  }

  // Listen for progress updates
  const progressListener = (msg) => {
    if (msg?.type === 'PAGE_TRANSLATION_PROGRESS') {
      if (progressBox) progressBox.classList.remove('hidden');
      const total = msg.total || 0;
      const done = msg.done || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = `Перекладено: ${done} з ${total} блоків`;
    }
  };

  chromeApi?.runtime?.onMessage?.addListener?.(progressListener);

  // Attach click handlers immediately before awaiting GET_PAGE_STATUS
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      toggleBtn.disabled = true;

      if (isTranslated) {
        try {
          const res = await chromeApi?.tabs?.sendMessage?.(tab.id, { action: 'RESTORE_ORIGINAL_CONTENT' });
          if (res && res.ok === false) {
            throw new Error(res.error || 'Помилка повернення оригіналу');
          }
          setButtonState(false);
        } catch (err) {
          alertFn(`Помилка повернення оригіналу: ${err.message}`);
        } finally {
          toggleBtn.disabled = false;
          if (progressBox) progressBox.classList.add('hidden');
        }
      } else {
        if (progressBox) progressBox.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressLabel) progressLabel.textContent = 'Пошук головного контенту...';

        try {
          const res = await chromeApi?.tabs?.sendMessage?.(tab.id, { action: 'TRANSLATE_MAIN_CONTENT' });
          if (!res?.ok) throw new Error(res?.error || 'Помилка перекладу');
          setButtonState(true);
        } catch (err) {
          alertFn(`Помилка перекладу: ${err.message}`);
        } finally {
          toggleBtn.disabled = false;
          if (progressBox) progressBox.classList.add('hidden');
        }
      }
    });
  }

  if (selectSectionBtn) {
    selectSectionBtn.addEventListener('click', async () => {
      try {
        await chromeApi?.tabs?.sendMessage?.(tab.id, { action: 'START_SECTION_INSPECTOR' });
      } catch (err) {
        alertFn(`Не вдалося запустити вибір секції: ${err.message}`);
        return;
      }
      if (typeof window !== 'undefined' && window.close) {
        window.close();
      }
    });
  }

  if (translateInputBtn) {
    translateInputBtn.addEventListener('click', async () => {
      try {
        await chromeApi?.tabs?.sendMessage?.(tab.id, { action: 'TRANSLATE_ACTIVE_INPUT' });
      } catch (err) {
        alertFn(`Не вдалося перекласти поле: ${err.message}`);
        return;
      }
      if (typeof window !== 'undefined' && window.close) {
        window.close();
      }
    });
  }

  setButtonState(await pageStatusPromise);

  return {
    engineBadge,
    langBadge,
    alertBox,
    toggleBtn,
    selectSectionBtn,
    translateInputBtn,
    openSettingsBtn,
    progressBox,
    progressBar,
    progressLabel,
    tab,
    getIsTranslated: () => isTranslated,
    progressListener
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPopup();
    });
  } else {
    initPopup();
  }
}
