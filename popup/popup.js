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

  // Get active tab
  let tab = null;
  try {
    const tabs = await chromeApi?.tabs?.query?.({ active: true, currentWindow: true });
    tab = tabs?.[0];
  } catch (err) {
    console.warn('Failed to query active tab:', err);
  }

  if (!tab?.id) {
    return {
      engineBadge,
      langBadge,
      alertBox,
      toggleBtn,
      selectSectionBtn,
      openSettingsBtn,
      progressBox,
      progressBar,
      progressLabel,
      tab: null
    };
  }

  // Load Settings
  let settings = {};
  try {
    const settingsRes = await chromeApi?.runtime?.sendMessage?.({ type: 'GET_SETTINGS' });
    settings = settingsRes?.data || {};
  } catch (err) {
    console.warn('Failed to get settings:', err);
  }

  if (engineBadge) {
    engineBadge.textContent = settings.activeEngine === 'local'
      ? '⚡ Офлайн (WebGPU)'
      : `🌐 ${settings.geminiModel || 'Gemini'}`;
  }
  if (langBadge) {
    langBadge.textContent = settings.targetLanguage || 'Українська';
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
  }

  // Check Page Status
  let isTranslated = false;
  try {
    const pageStatus = await chromeApi?.tabs?.sendMessage?.(tab.id, { action: 'GET_PAGE_STATUS' });
    isTranslated = Boolean(pageStatus?.isTranslated);
  } catch {
    // Content script might not be injected on restricted pages (e.g. chrome://)
  }

  function setButtonState(translated) {
    isTranslated = translated;
    updateButtonState(toggleBtn, isTranslated);
  }

  setButtonState(isTranslated);

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

  return {
    engineBadge,
    langBadge,
    alertBox,
    toggleBtn,
    selectSectionBtn,
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
