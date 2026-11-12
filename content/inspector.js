let activeInspector = null;

export function findSectionContainer(el, doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!el || !currentDoc || el === currentDoc.body || el === currentDoc.documentElement) return null;

  // Ignore extension elements
  if (el.closest && el.closest('#ai-section-highlighter, .ai-section-restore-badge, .ai-restore-selection-btn')) {
    return null;
  }

  let curr = el;
  let semanticCandidate = null;
  let divCandidate = null;
  let leafCandidate = null;

  while (curr && curr !== currentDoc.body && curr !== currentDoc.documentElement) {
    const tag = curr.tagName?.toLowerCase();
    const isSemantic = ['article', 'section', 'aside', 'main', 'blockquote', 'li', 'form'].includes(tag) ||
      (curr.getAttribute && ['region', 'article', 'feed'].includes(curr.getAttribute('role')));

    const textLen = (curr.innerText || '').trim().length;

    if (isSemantic && textLen >= 15) {
      semanticCandidate = curr;
      break;
    }

    if (tag === 'div' && textLen >= 25 && !divCandidate) {
      divCandidate = curr;
    }

    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) && !leafCandidate) {
      leafCandidate = curr;
    }

    curr = curr.parentElement;
  }

  return semanticCandidate || divCandidate || leafCandidate || el;
}

export function startSectionInspector(
  onSelectCallback,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentWin = win || (typeof window !== 'undefined' ? window : null);
  if (!currentDoc) return null;

  if (activeInspector) {
    activeInspector.stop();
  }

  let highlighter = currentDoc.getElementById('ai-section-highlighter');
  if (!highlighter) {
    highlighter = currentDoc.createElement('div');
    highlighter.id = 'ai-section-highlighter';
    highlighter.className = 'ai-section-highlighter';
    const tooltip = currentDoc.createElement('span');
    tooltip.className = 'ai-section-tooltip';
    tooltip.textContent = '🎯 Клікніть, щоб перекласти секцію • Esc — скасувати';
    highlighter.appendChild(tooltip);
    if (currentDoc.body) {
      currentDoc.body.appendChild(highlighter);
    }
  }

  let currentTarget = null;

  const onMouseMove = (e) => {
    const el = currentDoc.elementFromPoint ? currentDoc.elementFromPoint(e.clientX, e.clientY) : e.target;
    const container = findSectionContainer(el, currentDoc);
    if (!container) {
      if (highlighter.style) highlighter.style.display = 'none';
      currentTarget = null;
      return;
    }

    currentTarget = container;
    const rect = container.getBoundingClientRect ? container.getBoundingClientRect() : { top: 0, left: 0, width: 100, height: 100 };
    const scrollX = (currentWin && (currentWin.pageXOffset || currentDoc.documentElement?.scrollLeft)) || 0;
    const scrollY = (currentWin && (currentWin.pageYOffset || currentDoc.documentElement?.scrollTop)) || 0;

    if (highlighter.style) {
      highlighter.style.top = `${rect.top + scrollY}px`;
      highlighter.style.left = `${rect.left + scrollX}px`;
      highlighter.style.width = `${rect.width}px`;
      highlighter.style.height = `${rect.height}px`;
      highlighter.style.display = 'block';
    }
  };

  const onClick = (e) => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const selected = currentTarget;
    stop();
    if (selected && onSelectCallback) {
      onSelectCallback(selected);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      stop();
    }
  };

  const stop = () => {
    if (currentDoc.removeEventListener) {
      currentDoc.removeEventListener('mousemove', onMouseMove, true);
      currentDoc.removeEventListener('click', onClick, true);
      currentDoc.removeEventListener('keydown', onKeyDown, true);
    }
    if (highlighter && highlighter.style) {
      highlighter.style.display = 'none';
    }
    if (highlighter && highlighter.remove) {
      highlighter.remove();
    }
    activeInspector = null;
  };

  if (currentDoc.addEventListener) {
    currentDoc.addEventListener('mousemove', onMouseMove, true);
    currentDoc.addEventListener('click', onClick, true);
    currentDoc.addEventListener('keydown', onKeyDown, true);
  }

  activeInspector = { stop, highlighter };
  return activeInspector;
}

export function stopSectionInspector() {
  if (activeInspector) {
    activeInspector.stop();
  }
}
