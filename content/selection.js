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

    // Create persistent translated span with restore on click
    const translatedSpan = currentDoc.createElement('span');
    translatedSpan.className = 'ai-translated-selection';
    translatedSpan.textContent = translatedText;
    translatedSpan.title = 'Клікніть, щоб повернути оригінал';
    if (!translatedSpan.dataset) {
      translatedSpan.dataset = {};
    }
    translatedSpan.dataset.original = text;

    translatedSpan.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      const orig = translatedSpan.dataset.original;
      translatedSpan.replaceWith(currentDoc.createTextNode(orig));
    });

    tempSpan.replaceWith(translatedSpan);
  } catch (err) {
    if (typeof currentAlert === 'function') {
      currentAlert(`Помилка перекладу виділеного: ${err.message}`);
    }
    tempSpan.replaceWith(currentDoc.createTextNode(text));
  }
}
