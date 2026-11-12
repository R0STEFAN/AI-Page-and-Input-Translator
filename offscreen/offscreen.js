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

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    translatorPipeline = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      progress_callback: (p) => {
        if (progressCallback && p.status === 'progress') {
          progressCallback(Math.round((p.loaded / p.total) * 100));
        }
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
      getPipeline((percent) => {
        chrome.runtime.sendMessage({
          type: 'LOCAL_MODEL_DOWNLOAD_PROGRESS',
          progress: percent
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
