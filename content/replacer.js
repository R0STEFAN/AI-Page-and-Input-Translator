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
  const elements = doc.querySelectorAll('[data-ai-original-text], [data-ai-original-html]');
  const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => fn();
  schedule(() => {
    elements.forEach(el => {
      if (el.dataset && (el.dataset.aiOriginalHtml !== undefined || el.dataset.aiOriginalText !== undefined)) {
        const restored = el.dataset.aiOriginalHtml || el.dataset.aiOriginalText;
        if (el.innerHTML !== undefined) {
          el.innerHTML = restored;
        } else {
          el.innerText = restored;
        }
        if (el.classList && el.classList.remove) {
          el.classList.remove('ai-translated-block');
        }
        delete el.dataset.aiOriginalHtml;
        delete el.dataset.aiOriginalText;
      }
    });
    if (doc.body && doc.body.dataset) {
      delete doc.body.dataset.aiPageTranslated;
    }
    const badges = doc.querySelectorAll('.ai-section-restore-badge');
    if (badges && badges.forEach) {
      badges.forEach(b => {
        const parent = b.parentElement;
        if (parent && parent.style && parent.dataset) {
          if (parent.dataset.aiOrigPosition !== undefined) {
            parent.style.position = parent.dataset.aiOrigPosition;
            delete parent.dataset.aiOrigPosition;
          }
          if (parent.dataset.aiOrigPaddingBottom !== undefined) {
            parent.style.paddingBottom = parent.dataset.aiOrigPaddingBottom;
            delete parent.dataset.aiOrigPaddingBottom;
          }
        }
        if (b.remove) b.remove();
      });
    }
  });
}

export function attachSectionRestoreBadge(sectionElement, elements, doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!sectionElement || !currentDoc?.createElement) return null;

  // Remove prior badge if any
  const prior = sectionElement.querySelector ? sectionElement.querySelector('.ai-section-restore-badge') : null;
  if (prior && prior.remove) prior.remove();

  if (sectionElement.style) {
    if (!sectionElement.dataset) sectionElement.dataset = {};
    if (sectionElement.dataset.aiOrigPosition === undefined) {
      sectionElement.dataset.aiOrigPosition = sectionElement.style.position || '';
    }
    if (sectionElement.dataset.aiOrigPaddingBottom === undefined) {
      sectionElement.dataset.aiOrigPaddingBottom = sectionElement.style.paddingBottom || '';
    }
    if (!sectionElement.style.position || sectionElement.style.position === 'static') {
      sectionElement.style.position = 'relative';
    }
    const currentPad = parseFloat(sectionElement.style.paddingBottom) || 0;
    if (currentPad < 38) {
      sectionElement.style.paddingBottom = '38px';
    }
  }

  const badge = currentDoc.createElement('button');
  badge.className = 'ai-section-restore-badge';
  badge.title = 'Повернути оригінал секції';
  if (typeof badge.setAttribute === 'function') {
    badge.setAttribute('type', 'button');
    badge.setAttribute('aria-label', 'Повернути оригінал секції');
  }

  badge.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
    <span>Оригінал</span>
  `;

  badge.addEventListener('click', (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    (elements || []).forEach(el => {
      if (el.dataset && (el.dataset.aiOriginalHtml !== undefined || el.dataset.aiOriginalText !== undefined)) {
        const restored = el.dataset.aiOriginalHtml || el.dataset.aiOriginalText;
        if (el.innerHTML !== undefined) {
          el.innerHTML = restored;
        } else {
          el.innerText = restored;
        }
        if (el.classList && el.classList.remove) {
          el.classList.remove('ai-translated-block');
        }
        delete el.dataset.aiOriginalHtml;
        delete el.dataset.aiOriginalText;
      }
    });
    if (sectionElement.style && sectionElement.dataset) {
      if (sectionElement.dataset.aiOrigPosition !== undefined) {
        sectionElement.style.position = sectionElement.dataset.aiOrigPosition;
        delete sectionElement.dataset.aiOrigPosition;
      }
      if (sectionElement.dataset.aiOrigPaddingBottom !== undefined) {
        sectionElement.style.paddingBottom = sectionElement.dataset.aiOrigPaddingBottom;
        delete sectionElement.dataset.aiOrigPaddingBottom;
      }
    }
    if (badge.remove) badge.remove();
  });

  sectionElement.appendChild(badge);
  return badge;
}
