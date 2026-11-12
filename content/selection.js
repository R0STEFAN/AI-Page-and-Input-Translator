export function normalizeNewlines(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

export async function handleSelectionTranslation(
  win = (typeof window !== 'undefined' ? window : null),
  chromeObj = (typeof chrome !== 'undefined' ? chrome : null),
  alertFn = (typeof alert !== 'undefined' ? alert : (typeof window !== 'undefined' && window.alert ? window.alert.bind(window) : null))
) {
  const currentWin = win || (typeof window !== 'undefined' ? window : null);
  if (!currentWin || typeof currentWin.getSelection !== 'function') return;

  const currentDoc = currentWin.document || (typeof document !== 'undefined' ? document : null);
  if (!currentDoc) return;

  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);
  const currentAlert = alertFn || (typeof alert !== 'undefined' ? alert : (currentWin.alert ? currentWin.alert.bind(currentWin) : () => {}));

  const selection = currentWin.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const text = selection.toString().trim();
  if (text.length < 2) return;

  const range = selection.getRangeAt(0);
  if (!range) return;

  // Create temporary highlight span
  const tempSpan = currentDoc.createElement('span');
  tempSpan.className = 'ai-translating-pulse';
  tempSpan.textContent = text;
  if (tempSpan.style) {
    tempSpan.style.whiteSpace = 'pre-wrap';
  }

  range.deleteContents();
  range.insertNode(tempSpan);
  if (typeof selection.removeAllRanges === 'function') {
    selection.removeAllRanges();
  }

  try {
    if (!currentChrome?.runtime?.sendMessage) {
      throw new Error('Chrome runtime messaging is not available');
    }

    const payload = { text };
    const pageLang = currentDoc?.documentElement?.lang;
    if (pageLang) {
      payload.sourceLanguage = pageLang;
    }

    const res = await currentChrome.runtime.sendMessage({
      type: 'TRANSLATE_SELECTION',
      payload
    });

    if (!res || !res.ok) {
      throw new Error(res?.error || 'Unknown error');
    }

    const translatedText = res.data?.translation;
    if (typeof translatedText !== 'string') {
      throw new Error('Invalid translation response');
    }

    const cleanTranslated = normalizeNewlines(translatedText);
    const cleanOrig = normalizeNewlines(text);

    // Create persistent translated span
    const translatedSpan = currentDoc.createElement('span');
    translatedSpan.className = 'ai-translated-selection';
    translatedSpan.textContent = cleanTranslated;
    translatedSpan.title = 'Клікніть, щоб повернути оригінал';
    if (!translatedSpan.dataset) {
      translatedSpan.dataset = {};
    }
    translatedSpan.dataset.original = cleanOrig;

    if (translatedSpan.style) {
      translatedSpan.style.whiteSpace = 'pre-wrap';
      translatedSpan.style.background = 'transparent';
      translatedSpan.style.color = 'inherit';
      translatedSpan.style.font = 'inherit';
      translatedSpan.style.lineHeight = 'inherit';
    }

    // Restore button with undo icon at the end of the block
    const restoreBtn = currentDoc.createElement('button');
    restoreBtn.className = 'ai-restore-selection-btn';
    restoreBtn.title = 'Повернути оригінал';
    if (typeof restoreBtn.setAttribute === 'function') {
      restoreBtn.setAttribute('type', 'button');
      restoreBtn.setAttribute('aria-label', 'Повернути оригінал');
    }
    restoreBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

    const handleRestore = (e) => {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      const orig = translatedSpan.dataset.original || text;
      if (orig.includes('\n')) {
        const origSpan = currentDoc.createElement('span');
        if (origSpan.style) {
          origSpan.style.whiteSpace = 'pre-wrap';
        }
        origSpan.textContent = orig;
        translatedSpan.replaceWith(origSpan);
      } else {
        translatedSpan.replaceWith(currentDoc.createTextNode(orig));
      }
    };

    restoreBtn.addEventListener('click', handleRestore);
    translatedSpan.addEventListener('click', handleRestore);

    translatedSpan.appendChild(restoreBtn);
    tempSpan.replaceWith(translatedSpan);
  } catch (err) {
    if (typeof currentAlert === 'function') {
      currentAlert(`Помилка перекладу виділеного: ${err.message}`);
    }
    tempSpan.replaceWith(currentDoc.createTextNode(text));
  }
}
