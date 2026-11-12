export function updateEngineVisibility(engine, geminiSection, localSection) {
  if (engine === 'local') {
    geminiSection.classList.add('hidden');
    localSection.classList.remove('hidden');
  } else {
    geminiSection.classList.remove('hidden');
    localSection.classList.add('hidden');
  }
}

export async function initOptions(
  doc = typeof document !== 'undefined' ? document : null,
  chromeApi = typeof chrome !== 'undefined' ? chrome : null,
  alertFn = typeof alert !== 'undefined' ? alert : console.error
) {
  if (!doc) return;

  const engineGemini = doc.getElementById('engineGemini');
  const engineLocal = doc.getElementById('engineLocal');
  const geminiSection = doc.getElementById('geminiSection');
  const localSection = doc.getElementById('localSection');
  const apiKeyInput = doc.getElementById('apiKey');
  const toggleApiKeyBtn = doc.getElementById('toggleApiKey');
  const fetchModelsBtn = doc.getElementById('fetchModelsBtn');
  const modelSelect = doc.getElementById('modelSelect');
  const targetLanguageSelect = doc.getElementById('targetLanguage');
  const downloadModelBtn = doc.getElementById('downloadModelBtn');
  const modelStatusBadge = doc.getElementById('modelStatusBadge');
  const progressContainer = doc.getElementById('progressContainer');
  const progressBar = doc.getElementById('progressBar');
  const progressText = doc.getElementById('progressText');
  const saveBtn = doc.getElementById('saveBtn');
  const saveStatus = doc.getElementById('saveStatus');

  const updateVisibility = (engine) => updateEngineVisibility(engine, geminiSection, localSection);

  if (engineGemini) {
    engineGemini.addEventListener('change', () => updateVisibility('gemini'));
  }
  if (engineLocal) {
    engineLocal.addEventListener('change', () => updateVisibility('local'));
  }

  if (toggleApiKeyBtn && apiKeyInput) {
    toggleApiKeyBtn.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Load Settings
  if (chromeApi?.runtime?.sendMessage) {
    try {
      const settingsRes = await chromeApi.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsRes?.ok) {
        const s = settingsRes.data;
        if (s.activeEngine === 'local') {
          if (engineLocal) engineLocal.checked = true;
          updateVisibility('local');
        } else {
          if (engineGemini) engineGemini.checked = true;
          updateVisibility('gemini');
        }

        if (apiKeyInput) apiKeyInput.value = s.geminiApiKey || '';
        if (targetLanguageSelect) targetLanguageSelect.value = s.targetLanguage || 'Українська';

        if (modelSelect && Array.isArray(s.geminiAvailableModels) && s.geminiAvailableModels.length > 0) {
          modelSelect.innerHTML = s.geminiAvailableModels.map(m =>
            `<option value="${m}" ${m === s.geminiModel ? 'selected' : ''}>${m}</option>`
          ).join('');
        }

        if (s.localModelLoaded) {
          if (modelStatusBadge) {
            modelStatusBadge.textContent = 'Завантажено і готово';
            modelStatusBadge.classList.add('ready');
          }
          if (downloadModelBtn) {
            downloadModelBtn.textContent = 'Оновити модель';
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load initial settings:', err);
    }
  }

  // Fetch Models
  if (fetchModelsBtn) {
    fetchModelsBtn.addEventListener('click', async () => {
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      if (!apiKey) {
        alertFn('Будь ласка, введіть Gemini API ключ');
        return;
      }

      fetchModelsBtn.disabled = true;
      fetchModelsBtn.textContent = 'Завантаження...';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'FETCH_MODELS',
          payload: { apiKey }
        });

        if (!res.ok) throw new Error(res.error);

        if (modelSelect) {
          modelSelect.innerHTML = res.data.models.map(m =>
            `<option value="${m}">${m}</option>`
          ).join('');
        }

        if (saveStatus) {
          saveStatus.textContent = 'Моделі успішно оновлено!';
          saveStatus.style.color = '#10b981';
          setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 3000);
        }
      } catch (err) {
        alertFn(`Помилка отримання моделей: ${err.message}`);
      } finally {
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.textContent = 'Отримати моделі';
      }
    });
  }

  // Download Local Model
  if (downloadModelBtn) {
    downloadModelBtn.addEventListener('click', async () => {
      downloadModelBtn.disabled = true;
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = 'Ініціалізація...';

      // Listen for progress
      const progressListener = (msg) => {
        if (msg.type === 'LOCAL_MODEL_DOWNLOAD_PROGRESS') {
          if (progressBar) progressBar.style.width = `${msg.progress}%`;
          if (progressText) progressText.textContent = `${msg.progress}%`;
        }
      };

      if (chromeApi?.runtime?.onMessage?.addListener) {
        chromeApi.runtime.onMessage.addListener(progressListener);
      }

      try {
        const res = await chromeApi.runtime.sendMessage({ type: 'DOWNLOAD_LOCAL_MODEL' });
        if (!res.ok) throw new Error(res.error);

        if (modelStatusBadge) {
          modelStatusBadge.textContent = 'Завантажено і готово';
          modelStatusBadge.classList.add('ready');
        }
        if (downloadModelBtn) {
          downloadModelBtn.textContent = 'Оновити модель';
        }
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Готово!';
      } catch (err) {
        alertFn(`Помилка завантаження моделі: ${err.message}`);
      } finally {
        if (chromeApi?.runtime?.onMessage?.removeListener) {
          chromeApi.runtime.onMessage.removeListener(progressListener);
        }
        downloadModelBtn.disabled = false;
      }
    });
  }

  // Save Settings
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const activeEngine = engineLocal?.checked ? 'local' : 'gemini';
      const geminiApiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      const geminiModel = modelSelect ? modelSelect.value : '';
      const targetLanguage = targetLanguageSelect ? targetLanguageSelect.value : 'Українська';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'SAVE_SETTINGS',
          payload: { activeEngine, geminiApiKey, geminiModel, targetLanguage }
        });

        if (res?.ok) {
          if (saveStatus) {
            saveStatus.textContent = 'Налаштування збережено!';
            saveStatus.style.color = '#10b981';
            setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 2500);
          }
        } else {
          if (saveStatus) {
            saveStatus.textContent = 'Помилка збереження';
            saveStatus.style.color = '#ef4444';
          }
        }
      } catch (err) {
        if (saveStatus) {
          saveStatus.textContent = `Помилка: ${err.message}`;
          saveStatus.style.color = '#ef4444';
        }
      }
    });
  }

  return {
    engineGemini,
    engineLocal,
    geminiSection,
    localSection,
    apiKeyInput,
    toggleApiKeyBtn,
    fetchModelsBtn,
    modelSelect,
    targetLanguageSelect,
    downloadModelBtn,
    modelStatusBadge,
    progressContainer,
    progressBar,
    progressText,
    saveBtn,
    saveStatus
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initOptions();
    });
  } else {
    initOptions();
  }
}
