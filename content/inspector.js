let activeInspector = null;

export function isCompositeContainer(element, target) {
  if (!element) return false;

  const tag = element.tagName?.toLowerCase();
  const role = element.getAttribute?.('role');
  if (['main', 'body', 'html'].includes(tag) || ['main', 'feed'].includes(role)) {
    return true;
  }

  if (element.querySelectorAll) {
    const commentSelector = 'sh-comment, [id*="comment" i], [class*="comment" i], [id*="reply" i], [class*="reply" i], [slot="comments"]';
    const comments = element.querySelectorAll(commentSelector);

    if (comments.length > 0) {
      let targetInComment = false;
      for (const c of comments) {
        if (c === target || (c.contains && c.contains(target))) {
          targetInComment = true;
          break;
        }
      }

      if (!targetInComment) {
        return true;
      }

      if (comments.length > 1) {
        return true;
      }
    }

    const articles = element.querySelectorAll('article, [role="article"], sh-post');
    if (articles.length > 1) {
      return true;
    }
  }

  return false;
}

export function findSectionContainer(el, doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!el || !currentDoc || el === currentDoc.body || el === currentDoc.documentElement) return null;

  // Ignore extension elements
  if (el.closest && el.closest('#ai-section-highlighter, .ai-section-restore-badge, .ai-restore-selection-btn')) {
    return null;
  }

  let curr = el;
  const inlineTags = ['span', 'a', 'strong', 'em', 'b', 'i', 'code', 'small', 'sub', 'sup', 'mark', 'time'];
  while (curr && inlineTags.includes(curr.tagName?.toLowerCase()) && curr.parentElement && curr !== currentDoc.body) {
    curr = curr.parentElement;
  }

  let candidate = curr;

  while (curr && curr !== currentDoc.body && curr !== currentDoc.documentElement) {
    if (isCompositeContainer(curr, el)) {
      break;
    }

    const tag = curr.tagName?.toLowerCase();
    const textLen = (curr.innerText || '').trim().length;

    const isSectionTag = ['article', 'section', 'aside', 'blockquote', 'li', 'form'].includes(tag);
    const isContentDiv = tag === 'div' && textLen >= 25;

    if (isSectionTag && textLen >= 15) {
      candidate = curr;
      break;
    }

    if (isContentDiv) {
      candidate = curr;
    }

    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      candidate = curr;
    }

    curr = curr.parentElement;
  }

  return candidate || el;
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

  const tooltip = highlighter.querySelector ? highlighter.querySelector('.ai-section-tooltip') : null;
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

    if (tooltip && !highlighter.classList?.contains('ai-thinking')) {
      const tag = container.tagName?.toLowerCase();
      let label = 'секцію';
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        label = 'блок тексту';
      } else if (container.closest && container.closest('sh-comment, [class*="comment" i]')) {
        label = 'коментар';
      } else if ((container.closest && container.closest('sh-post, article')) || tag === 'article') {
        label = 'пост';
      }
      tooltip.textContent = `🎯 Перекласти ${label} • Esc — скасувати`;
    }
  };

  const detachEvents = () => {
    if (currentDoc.removeEventListener) {
      currentDoc.removeEventListener('mousemove', onMouseMove, true);
      currentDoc.removeEventListener('click', onClick, true);
      currentDoc.removeEventListener('keydown', onKeyDown, true);
    }
  };

  const setThinkingMode = (selectedEl) => {
    if (!highlighter) return;
    if (highlighter.classList && highlighter.classList.add) {
      highlighter.classList.add('ai-thinking');
    }
    const rect = selectedEl.getBoundingClientRect ? selectedEl.getBoundingClientRect() : { top: 0, left: 0, width: 100, height: 100 };
    const scrollX = (currentWin && (currentWin.pageXOffset || currentDoc.documentElement?.scrollLeft)) || 0;
    const scrollY = (currentWin && (currentWin.pageYOffset || currentDoc.documentElement?.scrollTop)) || 0;

    if (highlighter.style) {
      highlighter.style.top = `${rect.top + scrollY}px`;
      highlighter.style.left = `${rect.left + scrollX}px`;
      highlighter.style.width = `${rect.width}px`;
      highlighter.style.height = `${rect.height}px`;
      highlighter.style.display = 'block';
    }
    if (tooltip) {
      tooltip.innerHTML = '<span class="ai-thinking-spinner"></span><span>✨ Перекладаємо секцію...</span>';
    }
  };

  const finishThinking = () => {
    if (!highlighter) return;
    if (highlighter.classList && highlighter.classList.add) {
      highlighter.classList.add('ai-fade-out');
    }
    const timer = typeof setTimeout === 'function' ? setTimeout : (fn) => fn();
    timer(() => {
      if (highlighter && highlighter.remove) {
        highlighter.remove();
      }
      if (highlighter && highlighter.style) {
        highlighter.style.display = 'none';
      }
    }, 400);
    activeInspector = null;
  };

  const onClick = (e) => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    const selected = currentTarget;
    if (!selected) {
      stop();
      return;
    }

    detachEvents();
    setThinkingMode(selected);

    const session = {
      highlighter,
      setProgress: (done, total) => {
        if (tooltip) {
          tooltip.innerHTML = `<span class="ai-thinking-spinner"></span><span>✨ Перекладаємо: ${done} / ${total}</span>`;
        }
      },
      finish: () => {
        finishThinking();
      }
    };

    if (onSelectCallback) {
      onSelectCallback(selected, session);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      stop();
    }
  };

  const stop = () => {
    detachEvents();
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

  activeInspector = { stop, highlighter, finishThinking };
  return activeInspector;
}

export function stopSectionInspector() {
  if (activeInspector) {
    activeInspector.stop();
  }
}
