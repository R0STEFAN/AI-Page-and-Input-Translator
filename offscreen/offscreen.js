// Filter out ONNX Runtime graph optimization & initializer removal warnings
// so Chrome's extension error log (chrome://extensions/) stays clean.
const isIgnoredOnnxLog = (args) => {
  for (const arg of args) {
    const text = typeof arg === 'string' ? arg : (arg && arg.message ? arg.message : '');
    if (
      text.includes('[W:onnxruntime') ||
      text.includes('CleanUnusedInitializersAndNodeArgs') ||
      text.includes('Removing initializer')
    ) {
      return true;
    }
  }
  return false;
};

if (typeof console !== 'undefined') {
  const _origWarn = console.warn;
  console.warn = function(...args) {
    if (isIgnoredOnnxLog(args)) return;
    _origWarn.apply(console, args);
  };

  const _origError = console.error;
  console.error = function(...args) {
    if (isIgnoredOnnxLog(args)) return;
    _origError.apply(console, args);
  };

  const _origInfo = console.info;
  console.info = function(...args) {
    if (isIgnoredOnnxLog(args)) return;
    _origInfo.apply(console, args);
  };
}

export const LOCAL_MODEL_CONFIGS = {
  'Xenova/opus-mt-en-uk': {
    name: 'OPUS-MT (Легка ~105 МБ)',
    estimatedBytes: 111_000_000,
    isMarian: true
  },
  'Xenova/nllb-200-distilled-600M': {
    name: 'NLLB-200 (Повна ~874 МБ)',
    estimatedBytes: 916_800_000,
    isMarian: false
  }
};

// Estimated size of Xenova/nllb-200-distilled-600M quantized weights & tokenizer (~874 MB)
export const ESTIMATED_MODEL_BYTES = 916_800_000;

// Language code dictionary for NLLB-200
export const NLLB_LANG_MAP = {
  'uk': 'ukr_Cyrl',
  'українська': 'ukr_Cyrl',
  'ukrainian': 'ukr_Cyrl',
  'ukr_cyrl': 'ukr_Cyrl',
  'en': 'eng_Latn',
  'english': 'eng_Latn',
  'eng_latn': 'eng_Latn',
  'pl': 'pol_Latn',
  'polski': 'pol_Latn',
  'polish': 'pol_Latn',
  'de': 'deu_Latn',
  'deutsch': 'deu_Latn',
  'german': 'deu_Latn',
  'fr': 'fra_Latn',
  'français': 'fra_Latn',
  'french': 'fra_Latn',
  'es': 'spa_Latn',
  'español': 'spa_Latn',
  'spanish': 'spa_Latn',
  'it': 'ita_Latn',
  'italiano': 'ita_Latn',
  'italian': 'ita_Latn',
  'pt': 'por_Latn',
  'portuguese': 'por_Latn',
  'ru': 'rus_Cyrl',
  'russian': 'rus_Cyrl',
  'nl': 'nld_Latn',
  'dutch': 'nld_Latn',
  'tr': 'tur_Latn',
  'turkish': 'tur_Latn',
  'zh': 'zho_Hans',
  'chinese': 'zho_Hans',
  'ja': 'jpn_Jpan',
  'japanese': 'jpn_Jpan'
};

export function normalizeNewlines(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

export function getNllbLanguageCode(lang) {
  if (!lang) return 'ukr_Cyrl';
  const clean = lang.trim().toLowerCase();
  if (NLLB_LANG_MAP[clean]) return NLLB_LANG_MAP[clean];
  const prefix = clean.split('-')[0].split('_')[0];
  return NLLB_LANG_MAP[prefix] || 'ukr_Cyrl';
}

let translatorPipeline = null;
let currentLoadedModelId = null;
let isModelLoading = false;

// Dynamically imports Transformers.js when requested
export async function getPipeline(modelIdOrCallback, maybeCallback) {
  let modelId = currentLoadedModelId || 'Xenova/opus-mt-en-uk';
  let progressCallback = null;

  if (typeof modelIdOrCallback === 'string') {
    modelId = modelIdOrCallback;
    progressCallback = maybeCallback;
  } else if (typeof modelIdOrCallback === 'function') {
    progressCallback = modelIdOrCallback;
  }

  if (translatorPipeline && currentLoadedModelId === modelId) {
    return translatorPipeline;
  }

  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (translatorPipeline && currentLoadedModelId === modelId) {
      return translatorPipeline;
    }
  }

  isModelLoading = true;
  try {
    const { pipeline, env } = await import('./vendor/transformers.js');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    // Suppress verbose ONNX Runtime logging
    if (env.backends?.onnx) {
      env.backends.onnx.logLevel = 'error';
    }

    // Direct WASM binaries to local vendored files inside the extension
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('offscreen/vendor/wasm/');
    }

    // Enforce 1 thread for WASM to avoid SharedArrayBuffer restrictions in browser extensions
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }

    // Safely check if WebGPU adapter is actually available
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    let device = hasWebGPU ? 'webgpu' : 'wasm';
    if (hasWebGPU) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          device = 'wasm';
        }
      } catch {
        device = 'wasm';
      }
    }

    const config = LOCAL_MODEL_CONFIGS[modelId] || { estimatedBytes: 111_000_000 };
    const estimatedTotal = config.estimatedBytes;

    // Smooth monotonic multi-file download progress tracking
    const fileLoaded = {};
    let lastPercent = 0;

    translatorPipeline = await pipeline('translation', modelId, {
      device,
      progress_callback: (p) => {
        if (!p || !p.file || !progressCallback) return;

        if (typeof p.loaded === 'number') {
          fileLoaded[p.file] = p.loaded;
        } else if (p.status === 'done' && p.total) {
          fileLoaded[p.file] = p.total;
        }

        let loadedBytes = 0;
        for (const bytes of Object.values(fileLoaded)) {
          loadedBytes += bytes;
        }

        const totalBytes = Math.max(estimatedTotal, loadedBytes);
        const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
        lastPercent = Math.max(lastPercent, percent);

        const fileName = p.file.split('/').pop();
        const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(0);

        progressCallback(lastPercent, fileName, loadedMb, totalMb);
      }
    });

    currentLoadedModelId = modelId;

    if (progressCallback) {
      const mb = (estimatedTotal / (1024 * 1024)).toFixed(0);
      progressCallback(100, 'Готово', mb, mb);
    }

    return translatorPipeline;
  } finally {
    isModelLoading = false;
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'CHECK_LOCAL_MODEL') {
      sendResponse({ ok: true, data: { loaded: Boolean(translatorPipeline), modelId: currentLoadedModelId } });
      return false;
    }

    if (message.type === 'LOAD_LOCAL_MODEL') {
      const targetModel = message.payload?.modelId || 'Xenova/opus-mt-en-uk';
      getPipeline(targetModel, (percent, file, loadedMb, totalMb) => {
        chrome.runtime.sendMessage({
          type: 'LOCAL_MODEL_DOWNLOAD_PROGRESS',
          progress: percent,
          file: file,
          loadedMb: loadedMb,
          totalMb: totalMb
        }).catch(() => {});
      })
        .then(() => sendResponse({ ok: true, data: { success: true, modelId: targetModel } }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'TRANSLATE_LOCAL_BATCH') {
      (async () => {
        try {
          const { texts, targetLanguage, sourceLanguage, modelId } = message.payload || {};
          const targetModel = modelId || currentLoadedModelId || 'Xenova/opus-mt-en-uk';
          const pipe = await getPipeline(targetModel);
          const isOpus = targetModel.includes('opus');
          const tgtLangCode = getNllbLanguageCode(targetLanguage);
          const srcLangCode = sourceLanguage ? getNllbLanguageCode(sourceLanguage) : undefined;

          const translations = [];
          for (const text of (texts || [])) {
            if (!text || !text.trim()) {
              translations.push(text || '');
              continue;
            }
            try {
              // Faster inference parameters: greedy decoding (num_beams: 1) and tight length cap
              const opts = {
                max_new_tokens: 160,
                num_beams: 1,
                do_sample: false
              };
              if (!isOpus) {
                opts.tgt_lang = tgtLangCode;
                if (srcLangCode && srcLangCode !== tgtLangCode) {
                  opts.src_lang = srcLangCode;
                } else if (!srcLangCode) {
                  const hasCyrillic = /[а-яА-ЯіїєґІЇЄҐ]/.test(text);
                  if (hasCyrillic && tgtLangCode !== 'ukr_Cyrl') {
                    opts.src_lang = 'ukr_Cyrl';
                  } else if (!hasCyrillic && tgtLangCode !== 'eng_Latn') {
                    opts.src_lang = 'eng_Latn';
                  }
                }
              }
              const out = await pipe(text, opts);
              translations.push(normalizeNewlines(out[0]?.translation_text || text));
            } catch (err) {
              console.warn('Paragraph translation fallback error:', err);
              translations.push(text);
            }
          }
          sendResponse({ ok: true, data: { translations } });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
  });
}
