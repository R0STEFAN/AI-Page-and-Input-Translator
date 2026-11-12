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
  'italian': 'ita_Latn'
};

export function getNllbLanguageCode(lang) {
  if (!lang) return 'ukr_Cyrl';
  const clean = lang.trim().toLowerCase();
  return NLLB_LANG_MAP[clean] || 'ukr_Cyrl';
}

let translatorPipeline = null;
let isModelLoading = false;

// Dynamically imports Transformers.js when requested
export async function getPipeline(progressCallback) {
  if (translatorPipeline) return translatorPipeline;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return translatorPipeline;
  }

  isModelLoading = true;
  try {
    const { pipeline, env } = await import('./vendor/transformers.js');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

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

    // Monotonic multi-file download progress tracking
    const fileProgress = {};
    let maxPercent = 0;

    translatorPipeline = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
      device,
      progress_callback: (p) => {
        if (!p || !p.file || !progressCallback) return;

        if (p.status === 'initiate' || p.status === 'download') {
          if (!fileProgress[p.file]) {
            fileProgress[p.file] = { loaded: 0, total: p.total || 0 };
          }
        } else if (p.status === 'progress') {
          fileProgress[p.file] = {
            loaded: p.loaded || 0,
            total: Math.max(p.total || 0, fileProgress[p.file]?.total || 0)
          };
        } else if (p.status === 'done') {
          if (fileProgress[p.file]) {
            fileProgress[p.file].loaded = fileProgress[p.file].total;
          }
        }

        let totalBytes = 0;
        let loadedBytes = 0;
        for (const item of Object.values(fileProgress)) {
          totalBytes += item.total;
          loadedBytes += item.loaded;
        }

        let percent = 0;
        if (totalBytes > 0) {
          percent = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
        }

        maxPercent = Math.max(maxPercent, percent);
        const fileName = p.file.split('/').pop();
        progressCallback(maxPercent, fileName);
      }
    });
    return translatorPipeline;
  } finally {
    isModelLoading = false;
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'CHECK_LOCAL_MODEL') {
      sendResponse({ ok: true, data: { loaded: Boolean(translatorPipeline) } });
      return false;
    }

    if (message.type === 'LOAD_LOCAL_MODEL') {
      getPipeline((percent, file) => {
        chrome.runtime.sendMessage({
          type: 'LOCAL_MODEL_DOWNLOAD_PROGRESS',
          progress: percent,
          file: file
        }).catch(() => {});
      })
        .then(() => sendResponse({ ok: true, data: { success: true } }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'TRANSLATE_LOCAL_BATCH') {
      (async () => {
        try {
          const pipe = await getPipeline();
          const { texts, targetLanguage } = message.payload;
          const tgtLangCode = getNllbLanguageCode(targetLanguage);

          const translations = [];
          for (const text of texts) {
            const out = await pipe(text, {
              tgt_lang: tgtLangCode
            });
            translations.push(out[0]?.translation_text || text);
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
