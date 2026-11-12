export function replaceTextBatch(elements, translations) {
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
  schedule(() => {
    elements.forEach((el, idx) => {
      const translated = translations[idx];
      if (typeof translated === 'string' && translated.trim()) {
        el.innerText = translated;
        if (el.classList && el.classList.add) {
          el.classList.add('ai-translated-block');
        }
      }
    });
  });
}

export function restoreOriginalText(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.querySelectorAll) return;
  const elements = doc.querySelectorAll('[data-ai-original-text]');
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
  schedule(() => {
    elements.forEach(el => {
      if (el.dataset && el.dataset.aiOriginalText !== undefined) {
        el.innerText = el.dataset.aiOriginalText;
        if (el.classList && el.classList.remove) {
          el.classList.remove('ai-translated-block');
        }
        delete el.dataset.aiOriginalText;
      }
    });
    if (doc.body && doc.body.dataset) {
      delete doc.body.dataset.aiPageTranslated;
    }
  });
}
