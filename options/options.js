export function updateEngineVisibility(engine, geminiSection, localSection, openrouterSection, coarenaSection, opencodeSection) {
  geminiSection?.classList?.add('hidden');
  localSection?.classList?.add('hidden');
  openrouterSection?.classList?.add('hidden');
  coarenaSection?.classList?.add('hidden');
  opencodeSection?.classList?.add('hidden');

  if (engine === 'local') {
    localSection?.classList?.remove('hidden');
  } else if (engine === 'openrouter') {
    openrouterSection?.classList?.remove('hidden');
  } else if (engine === 'coarena') {
    coarenaSection?.classList?.remove('hidden');
  } else if (engine === 'opencode') {
    opencodeSection?.classList?.remove('hidden');
  } else {
    geminiSection?.classList?.remove('hidden');
  }
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function populateSelectModels(selectEl, models, selectedModel) {
  if (!selectEl || !Array.isArray(models) || models.length === 0) return;
  selectEl.innerHTML = models.map(m => {
    const safe = escapeHtmlAttr(m);
    return `<option value="${safe}" ${m === selectedModel ? 'selected' : ''}>${safe}</option>`;
  }).join('');
}

export async function initOptions(
  doc = typeof document !== 'undefined' ? document : null,
  chromeApi = typeof chrome !== 'undefined' ? chrome : null,
  alertFn = typeof alert !== 'undefined' ? alert : console.error
) {
  if (!doc) return;

  const engineGemini = doc.getElementById('engineGemini');
  const engineCoarena = doc.getElementById('engineCoarena');
  const engineOpenRouter = doc.getElementById('engineOpenRouter');
  const engineOpenCode = doc.getElementById('engineOpenCode');
  const engineLocal = doc.getElementById('engineLocal');
  const geminiSection = doc.getElementById('geminiSection');
  const coarenaSection = doc.getElementById('coarenaSection');
  const openrouterSection = doc.getElementById('openrouterSection');
  const opencodeSection = doc.getElementById('opencodeSection');
  const localSection = doc.getElementById('localSection');
  const apiKeyInput = doc.getElementById('apiKey');
  const toggleApiKeyBtn = doc.getElementById('toggleApiKey');
  const fetchModelsBtn = doc.getElementById('fetchModelsBtn');
  const modelSelect = doc.getElementById('modelSelect');
  const coarenaApiKeyInput = doc.getElementById('coarenaApiKey');
  const toggleCoarenaApiKeyBtn = doc.getElementById('toggleCoarenaApiKey');
  const fetchCoarenaModelsBtn = doc.getElementById('fetchCoarenaModelsBtn');
  const coarenaModelSelect = doc.getElementById('coarenaModelSelect');
  const opencodeApiKeyInput = doc.getElementById('opencodeApiKey');
  const toggleOpenCodeApiKeyBtn = doc.getElementById('toggleOpenCodeApiKey');
  const fetchOpenCodeModelsBtn = doc.getElementById('fetchOpenCodeModelsBtn');
  const opencodeModelSelect = doc.getElementById('opencodeModelSelect');
  const openrouterApiKeyInput = doc.getElementById('openrouterApiKey');
  const toggleOpenRouterApiKeyBtn = doc.getElementById('toggleOpenRouterApiKey');
  const fetchOpenRouterModelsBtn = doc.getElementById('fetchOpenRouterModelsBtn');
  const openrouterModelSelect = doc.getElementById('openrouterModelSelect');
  const targetLanguageSelect = doc.getElementById('targetLanguage');
  const inputTargetLanguageSelect = doc.getElementById('inputTargetLanguage');
  const downloadModelBtn = doc.getElementById('downloadModelBtn');
  const modelStatusBadge = doc.getElementById('modelStatusBadge');
  const localModelSelect = doc.getElementById('localModelSelect');
  const localModelDesc = doc.getElementById('localModelDesc');
  const progressContainer = doc.getElementById('progressContainer');
  const progressBar = doc.getElementById('progressBar');
  const progressText = doc.getElementById('progressText');
  const saveBtn = doc.getElementById('saveBtn');
  const saveStatus = doc.getElementById('saveStatus');

  const LOCAL_DESCRIPTIONS = {
    'Xenova/opus-mt-en-uk': 'Оптимізована модель MarianMT: у 8 разів легша за NLLB (~105 МБ), працює швидко і майже не навантажує Core i5 та вбудовану графіку.',
    'Xenova/nllb-200-distilled-600M': 'Повна мультимовна модель від Meta (~874 МБ, 200 мов). Вимагає більше оперативної пам\'яті та навантажує процесор.'
  };

  if (localModelSelect) {
    localModelSelect.addEventListener('change', () => {
      const val = localModelSelect.value;
      if (localModelDesc) {
        localModelDesc.textContent = LOCAL_DESCRIPTIONS[val] || '';
      }
    });
  }

  const updateVisibility = (engine) => updateEngineVisibility(engine, geminiSection, localSection, openrouterSection, coarenaSection, opencodeSection);

  if (engineGemini) {
    engineGemini.addEventListener('change', () => updateVisibility('gemini'));
  }
  if (engineCoarena) {
    engineCoarena.addEventListener('change', () => updateVisibility('coarena'));
  }
  if (engineOpenRouter) {
    engineOpenRouter.addEventListener('change', () => updateVisibility('openrouter'));
  }
  if (engineOpenCode) {
    engineOpenCode.addEventListener('change', () => updateVisibility('opencode'));
  }
  if (engineLocal) {
    engineLocal.addEventListener('change', () => updateVisibility('local'));
  }

  if (toggleApiKeyBtn && apiKeyInput) {
    toggleApiKeyBtn.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (toggleCoarenaApiKeyBtn && coarenaApiKeyInput) {
    toggleCoarenaApiKeyBtn.addEventListener('click', () => {
      coarenaApiKeyInput.type = coarenaApiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (toggleOpenCodeApiKeyBtn && opencodeApiKeyInput) {
    toggleOpenCodeApiKeyBtn.addEventListener('click', () => {
      opencodeApiKeyInput.type = opencodeApiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  if (toggleOpenRouterApiKeyBtn && openrouterApiKeyInput) {
    toggleOpenRouterApiKeyBtn.addEventListener('click', () => {
      openrouterApiKeyInput.type = openrouterApiKeyInput.type === 'password' ? 'text' : 'password';
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
        } else if (s.activeEngine === 'openrouter') {
          if (engineOpenRouter) engineOpenRouter.checked = true;
          updateVisibility('openrouter');
        } else if (s.activeEngine === 'coarena') {
          if (engineCoarena) engineCoarena.checked = true;
          updateVisibility('coarena');
        } else if (s.activeEngine === 'opencode') {
          if (engineOpenCode) engineOpenCode.checked = true;
          updateVisibility('opencode');
        } else {
          if (engineGemini) engineGemini.checked = true;
          updateVisibility('gemini');
        }

        if (apiKeyInput) apiKeyInput.value = s.geminiApiKey || '';
        if (coarenaApiKeyInput) coarenaApiKeyInput.value = s.coarenaApiKey || '';
        if (opencodeApiKeyInput) opencodeApiKeyInput.value = s.opencodeApiKey || '';
        if (openrouterApiKeyInput) openrouterApiKeyInput.value = s.openrouterApiKey || '';
        if (targetLanguageSelect) targetLanguageSelect.value = s.targetLanguage || 'Українська';
        if (inputTargetLanguageSelect) inputTargetLanguageSelect.value = s.inputTargetLanguage || 'English';

        populateSelectModels(modelSelect, s.geminiAvailableModels, s.geminiModel);
        populateSelectModels(coarenaModelSelect, s.coarenaAvailableModels, s.coarenaModel);
        populateSelectModels(opencodeModelSelect, s.opencodeAvailableModels, s.opencodeModel);
        populateSelectModels(openrouterModelSelect, s.openrouterAvailableModels, s.openrouterModel);

        if (s.localSelectedModel && localModelSelect) {
          localModelSelect.value = s.localSelectedModel;
          if (localModelDesc) {
            localModelDesc.textContent = LOCAL_DESCRIPTIONS[s.localSelectedModel] || '';
          }
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

  // Fetch Coarena Models
  if (fetchCoarenaModelsBtn) {
    fetchCoarenaModelsBtn.addEventListener('click', async () => {
      const apiKey = coarenaApiKeyInput ? coarenaApiKeyInput.value.trim() : '';
      fetchCoarenaModelsBtn.disabled = true;
      fetchCoarenaModelsBtn.textContent = 'Завантаження...';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'FETCH_COARENA_MODELS',
          payload: { apiKey }
        });

        if (!res.ok) throw new Error(res.error);

        const prevSelected = coarenaModelSelect ? coarenaModelSelect.value : '';
        const selected = res.data.models.includes(prevSelected) ? prevSelected : res.data.models[0];
        populateSelectModels(coarenaModelSelect, res.data.models, selected);

        if (saveStatus) {
          saveStatus.textContent = `Знайдено ${res.data.models.length} моделей Coarena!`;
          saveStatus.style.color = '#10b981';
          setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 3000);
        }
      } catch (err) {
        alertFn(`Помилка отримання моделей Coarena: ${err.message}`);
      } finally {
        fetchCoarenaModelsBtn.disabled = false;
        fetchCoarenaModelsBtn.textContent = 'Отримати моделі';
      }
    });
  }
  // Fetch OpenCode Models
  if (fetchOpenCodeModelsBtn) {
    fetchOpenCodeModelsBtn.addEventListener('click', async () => {
      const apiKey = opencodeApiKeyInput ? opencodeApiKeyInput.value.trim() : '';
      fetchOpenCodeModelsBtn.disabled = true;
      fetchOpenCodeModelsBtn.textContent = 'Завантаження...';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'FETCH_OPENCODE_MODELS',
          payload: { apiKey }
        });

        if (!res.ok) throw new Error(res.error);

        const prevSelected = opencodeModelSelect ? opencodeModelSelect.value : '';
        const selected = res.data.models.includes(prevSelected) ? prevSelected : res.data.models[0];
        populateSelectModels(opencodeModelSelect, res.data.models, selected);

        if (saveStatus) {
          saveStatus.textContent = `Знайдено ${res.data.models.length} моделей OpenCode!`;
          saveStatus.style.color = '#10b981';
          setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 3000);
        }
      } catch (err) {
        alertFn(`Помилка отримання моделей OpenCode: ${err.message}`);
      } finally {
        fetchOpenCodeModelsBtn.disabled = false;
        fetchOpenCodeModelsBtn.textContent = 'Отримати моделі';
      }
    });
  }

  // Fetch OpenRouter Free Models
  if (fetchOpenRouterModelsBtn) {
    fetchOpenRouterModelsBtn.addEventListener('click', async () => {
      const apiKey = openrouterApiKeyInput ? openrouterApiKeyInput.value.trim() : '';
      fetchOpenRouterModelsBtn.disabled = true;
      fetchOpenRouterModelsBtn.textContent = 'Завантаження...';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'FETCH_OPENROUTER_MODELS',
          payload: { apiKey }
        });

        if (!res.ok) throw new Error(res.error);

        const prevSelected = openrouterModelSelect ? openrouterModelSelect.value : '';
        const selected = res.data.models.includes(prevSelected) ? prevSelected : res.data.models[0];
        populateSelectModels(openrouterModelSelect, res.data.models, selected);

        if (saveStatus) {
          saveStatus.textContent = `Знайдено ${res.data.models.length} free моделей OpenRouter!`;
          saveStatus.style.color = '#10b981';
          setTimeout(() => { if (saveStatus) saveStatus.textContent = ''; }, 3000);
        }
      } catch (err) {
        alertFn(`Помилка отримання моделей OpenRouter: ${err.message}`);
      } finally {
        fetchOpenRouterModelsBtn.disabled = false;
        fetchOpenRouterModelsBtn.textContent = 'Отримати free моделі';
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
          if (progressText) {
            let label = `${msg.progress}%`;
            if (msg.file) {
              if (msg.loadedMb && msg.totalMb) {
                label = `Завантаження (${msg.file}): ${msg.progress}% (${msg.loadedMb} / ${msg.totalMb} MB)`;
              } else {
                label = `Завантаження (${msg.file}): ${msg.progress}%`;
              }
            }
            progressText.textContent = label;
          }
        }
      };

      if (chromeApi?.runtime?.onMessage?.addListener) {
        chromeApi.runtime.onMessage.addListener(progressListener);
      }

      try {
        const modelId = localModelSelect ? localModelSelect.value : 'Xenova/opus-mt-en-uk';
        const res = await chromeApi.runtime.sendMessage({
          type: 'DOWNLOAD_LOCAL_MODEL',
          payload: { modelId }
        });
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
      let activeEngine = 'gemini';
      if (engineLocal?.checked) {
        activeEngine = 'local';
      } else if (engineOpenRouter?.checked) {
        activeEngine = 'openrouter';
      } else if (engineCoarena?.checked) {
        activeEngine = 'coarena';
      } else if (engineOpenCode?.checked) {
        activeEngine = 'opencode';
      }
      const geminiApiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      const geminiModel = modelSelect ? modelSelect.value : '';
      const coarenaApiKey = coarenaApiKeyInput ? coarenaApiKeyInput.value.trim() : '';
      const coarenaModel = coarenaModelSelect ? coarenaModelSelect.value : 'claude-haiku-5-5';
      const opencodeApiKey = opencodeApiKeyInput ? opencodeApiKeyInput.value.trim() : '';
      const opencodeModel = opencodeModelSelect ? opencodeModelSelect.value : 'nemotron-3.5-lightning-free';
      const openrouterApiKey = openrouterApiKeyInput ? openrouterApiKeyInput.value.trim() : '';
      const openrouterModel = openrouterModelSelect ? openrouterModelSelect.value : 'openrouter/free';
      const targetLanguage = targetLanguageSelect ? targetLanguageSelect.value : 'Українська';
      const inputTargetLanguage = inputTargetLanguageSelect ? inputTargetLanguageSelect.value : 'English';
      const localSelectedModel = localModelSelect ? localModelSelect.value : 'Xenova/opus-mt-en-uk';

      try {
        const res = await chromeApi.runtime.sendMessage({
          type: 'SAVE_SETTINGS',
          payload: {
            activeEngine,
            geminiApiKey,
            geminiModel,
            coarenaApiKey,
            coarenaModel,
            opencodeApiKey,
            opencodeModel,
            openrouterApiKey,
            openrouterModel,
            targetLanguage,
            inputTargetLanguage,
            localSelectedModel
          }
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
    engineCoarena,
    engineOpenRouter,
    engineLocal,
    geminiSection,
    coarenaSection,
    openrouterSection,
    localSection,
    apiKeyInput,
    toggleApiKeyBtn,
    fetchModelsBtn,
    modelSelect,
    coarenaApiKeyInput,
    toggleCoarenaApiKeyBtn,
    fetchCoarenaModelsBtn,
    coarenaModelSelect,
    opencodeApiKeyInput,
    toggleOpenCodeApiKeyBtn,
    fetchOpenCodeModelsBtn,
    opencodeModelSelect,
    openrouterApiKeyInput,
    toggleOpenRouterApiKeyBtn,
    fetchOpenRouterModelsBtn,
    openrouterModelSelect,
    targetLanguageSelect,
    inputTargetLanguageSelect,
    downloadModelBtn,
    modelStatusBadge,
    localModelSelect,
    localModelDesc,
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
