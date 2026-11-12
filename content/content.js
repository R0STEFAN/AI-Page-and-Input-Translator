import { findMainContent } from './detector.js';
import { collectTextElements } from './walker.js';
import { replaceTextBatch, restoreOriginalText, attachSectionRestoreBadge } from './replacer.js';
import { handleSelectionTranslation } from './selection.js';
import { startSectionInspector } from './inspector.js';

export const BATCH_SIZE = 15;

export async function translateMainContent(
  progressCallback,
  doc = (typeof document !== 'undefined' ? document : null),
  chromeObj = (typeof chrome !== 'undefined' ? chrome : null)
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);

  const root = findMainContent(currentDoc);
  const elements = collectTextElements(root);

  if (elements.length === 0) {
    throw new Error('Не знайдено текстових блоків для перекладу');
  }

  if (currentDoc?.body?.dataset) {
    currentDoc.body.dataset.aiPageTranslated = 'true';
  }

  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    if (currentDoc?.body?.dataset?.aiPageTranslated !== 'true') {
      return;
    }

    const batchElements = elements.slice(i, i + BATCH_SIZE);
    const texts = batchElements.map(el => el.innerText);

    if (!currentChrome?.runtime?.sendMessage) {
      throw new Error('Chrome runtime messaging is not available');
    }

    const payload = { texts };
    const pageLang = currentDoc?.documentElement?.lang;
    if (pageLang) {
      payload.sourceLanguage = pageLang;
    }

    const res = await currentChrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      payload
    });

    if (currentDoc?.body?.dataset?.aiPageTranslated !== 'true') {
      return;
    }

    if (!res || !res.ok) {
      throw new Error(res?.error || 'Batch translation failed');
    }

    replaceTextBatch(batchElements, res.data.translations);

    if (progressCallback) {
      progressCallback(Math.min(i + BATCH_SIZE, elements.length), elements.length);
    }
  }
}

export async function translateSection(
  sectionElement,
  progressCallback,
  doc = (typeof document !== 'undefined' ? document : null),
  chromeObj = (typeof chrome !== 'undefined' ? chrome : null)
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);

  if (!sectionElement) {
    throw new Error('Секцію не вибрано');
  }

  let elements = collectTextElements(sectionElement);

  if (elements.length === 0) {
    const text = (sectionElement.innerText || '').trim();
    if (text.length >= 2 && (!sectionElement.closest || !sectionElement.closest('pre, code, noscript, style, script, .ai-translated-block'))) {
      if (!sectionElement.dataset) sectionElement.dataset = {};
      if (!sectionElement.dataset.aiOriginalText) sectionElement.dataset.aiOriginalText = sectionElement.innerText;
      if (!sectionElement.dataset.aiOriginalHtml) sectionElement.dataset.aiOriginalHtml = sectionElement.innerHTML || sectionElement.innerText;
      elements = [sectionElement];
    }
  }

  if (elements.length === 0) {
    throw new Error('У вибраній секції не знайдено тексту для перекладу');
  }

  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    const batchElements = elements.slice(i, i + BATCH_SIZE);
    const texts = batchElements.map(el => el.innerText);

    if (!currentChrome?.runtime?.sendMessage) {
      throw new Error('Chrome runtime messaging is not available');
    }

    const payload = { texts };
    const pageLang = currentDoc?.documentElement?.lang;
    if (pageLang) {
      payload.sourceLanguage = pageLang;
    }

    const res = await currentChrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      payload
    });

    if (!res || !res.ok) {
      throw new Error(res?.error || 'Batch translation failed');
    }

    replaceTextBatch(batchElements, res.data.translations);

    if (progressCallback) {
      progressCallback(Math.min(i + BATCH_SIZE, elements.length), elements.length);
    }
  }

  attachSectionRestoreBadge(sectionElement, elements, currentDoc);
  return elements;
}

export function handleContentMessage(
  message,
  sender,
  sendResponse,
  doc = (typeof document !== 'undefined' ? document : null),
  chromeObj = (typeof chrome !== 'undefined' ? chrome : null),
  win = (typeof window !== 'undefined' ? window : null)
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);
  const currentWin = win || (typeof window !== 'undefined' ? window : null);

  if (!message) return false;

  if (message.action === 'TRIGGER_SELECTION_TRANSLATION') {
    handleSelectionTranslation(currentWin, currentChrome);
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'START_SECTION_INSPECTOR') {
    startSectionInspector((selectedElement, session) => {
      translateSection(
        selectedElement,
        (done, total) => {
          if (session?.setProgress) {
            session.setProgress(done, total);
          }
          if (currentChrome?.runtime?.sendMessage) {
            currentChrome.runtime.sendMessage({
              type: 'PAGE_TRANSLATION_PROGRESS',
              done,
              total
            }).catch(() => {});
          }
        },
        currentDoc,
        currentChrome
      )
        .then(() => {
          if (session?.finish) {
            session.finish();
          }
        })
        .catch((err) => {
          if (session?.finish) {
            session.finish();
          }
          if (currentWin?.alert) {
            currentWin.alert(`Помилка перекладу секції: ${err.message}`);
          }
        });
    }, currentDoc, currentWin);

    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'GET_PAGE_STATUS') {
    const isTranslated = currentDoc?.body?.dataset?.aiPageTranslated === 'true';
    sendResponse({ ok: true, isTranslated });
    return false;
  }

  if (message.action === 'TRANSLATE_MAIN_CONTENT') {
    translateMainContent((done, total) => {
      if (currentChrome?.runtime?.sendMessage) {
        currentChrome.runtime.sendMessage({
          type: 'PAGE_TRANSLATION_PROGRESS',
          done,
          total
        }).catch(() => {});
      }
    }, currentDoc, currentChrome)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async translation
  }

  if (message.action === 'RESTORE_ORIGINAL_CONTENT') {
    restoreOriginalText(currentDoc);
    sendResponse({ ok: true });
    return false;
  }

  return false;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(handleContentMessage);
}
