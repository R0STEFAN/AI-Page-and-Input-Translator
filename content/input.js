let lastFocusedEditable = null;

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local',
  'file', 'hidden', 'image', 'month', 'radio', 'range',
  'reset', 'submit', 'time', 'week'
]);

export function getEditableTarget(el) {
  if (!el) return null;

  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') {
    return el;
  }

  if (tag === 'INPUT') {
    const type = (el.type || el.getAttribute?.('type') || 'text').toLowerCase();
    return NON_TEXT_INPUT_TYPES.has(type) ? null : el;
  }

  // Handle contenteditable elements (including children inside rich-text editors)
  const isCE = el.isContentEditable === true ||
    el.getAttribute?.('contenteditable') === 'true' ||
    el.getAttribute?.('contenteditable') === '';

  if (isCE) {
    let root = el;
    while (
      root.parentElement &&
      (root.parentElement.isContentEditable === true ||
       root.parentElement.getAttribute?.('contenteditable') === 'true' ||
       root.parentElement.getAttribute?.('contenteditable') === '')
    ) {
      root = root.parentElement;
    }
    return root;
  }

  if (el.closest) {
    const ceAncestor = el.closest('[contenteditable="true"], [contenteditable=""]');
    if (ceAncestor) return getEditableTarget(ceAncestor);
  }

  return null;
}

export function initInputTracker(doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!currentDoc?.addEventListener) return;

  const track = (e) => {
    const editable = getEditableTarget(e?.target);
    if (editable) {
      lastFocusedEditable = editable;
    }
  };

  currentDoc.addEventListener('focusin', track, true);
  currentDoc.addEventListener('mousedown', track, true);
}

export function resetLastFocusedEditable() {
  lastFocusedEditable = null;
}

export function findActiveEditableElement(doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!currentDoc) return null;

  const active = getEditableTarget(currentDoc.activeElement);
  if (active) return active;

  if (lastFocusedEditable && lastFocusedEditable.isConnected !== false) {
    return lastFocusedEditable;
  }

  return null;
}

export function readEditableText(el) {
  if (!el) return '';
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return el.value || '';
  }
  return (el.innerText !== undefined ? el.innerText : el.textContent) || '';
}

export function writeEditableText(
  el,
  translatedText,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentWin = win || (typeof window !== 'undefined' ? window : null);
  if (!el) return false;

  if (typeof el.focus === 'function') {
    el.focus();
  }

  const tag = el.tagName?.toUpperCase();
  const EventCtor = currentWin?.Event || (typeof Event !== 'undefined' ? Event : null);
  const InputEventCtor = currentWin?.InputEvent || EventCtor;

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    let execOk = false;
    if (typeof currentDoc?.execCommand === 'function' && typeof el.setSelectionRange === 'function') {
      try {
        el.setSelectionRange(0, (el.value || '').length);
        execOk = Boolean(currentDoc.execCommand('insertText', false, translatedText));
      } catch {
        execOk = false;
      }
    }

    if (!execOk || el.value !== translatedText) {
      const proto = tag === 'TEXTAREA'
        ? currentWin?.HTMLTextAreaElement?.prototype
        : currentWin?.HTMLInputElement?.prototype;
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, translatedText);
      } else {
        el.value = translatedText;
      }

      if (typeof el.dispatchEvent === 'function' && InputEventCtor) {
        try {
          el.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertReplacementText', data: translatedText }));
        } catch {
          el.dispatchEvent(new EventCtor('input', { bubbles: true }));
        }
        if (EventCtor) {
          el.dispatchEvent(new EventCtor('change', { bubbles: true }));
        }
      }
    }
    return true;
  }

  // Rich-text / contenteditable
  let execOk = false;
  if (currentWin?.getSelection && currentDoc?.createRange && typeof currentDoc?.execCommand === 'function') {
    try {
      const sel = currentWin.getSelection();
      const range = currentDoc.createRange();
      if (range.selectNodeContents && sel?.removeAllRanges && sel?.addRange) {
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        execOk = Boolean(currentDoc.execCommand('insertText', false, translatedText));
      }
    } catch {
      execOk = false;
    }
  }

  const currentVal = (el.innerText !== undefined ? el.innerText : el.textContent) || '';
  if (!execOk || currentVal.trim() !== translatedText.trim()) {
    if (el.innerText !== undefined) {
      el.innerText = translatedText;
    } else {
      el.textContent = translatedText;
    }

    if (typeof el.dispatchEvent === 'function' && InputEventCtor) {
      try {
        el.dispatchEvent(new InputEventCtor('input', { bubbles: true }));
      } catch {
        if (EventCtor) el.dispatchEvent(new EventCtor('input', { bubbles: true }));
      }
    }
  }

  return true;
}

function showInputThinkingOverlay(el, doc, win) {
  if (!doc?.createElement || !doc?.body) return () => {};

  const overlay = doc.createElement('div');
  overlay.id = 'ai-input-thinking-overlay';
  overlay.className = 'ai-section-highlighter ai-thinking';

  const tooltip = doc.createElement('span');
  tooltip.className = 'ai-section-tooltip';
  tooltip.innerHTML = '<span class="ai-thinking-spinner"></span><span>✨ Перекладаємо поле вводу...</span>';
  overlay.appendChild(tooltip);

  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, left: 0, width: 200, height: 40 };
  const scrollX = (win && (win.pageXOffset || doc.documentElement?.scrollLeft)) || 0;
  const scrollY = (win && (win.pageYOffset || doc.documentElement?.scrollTop)) || 0;

  if (overlay.style) {
    overlay.style.top = `${rect.top + scrollY}px`;
    overlay.style.left = `${rect.left + scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.display = 'block';
  }

  doc.body.appendChild(overlay);

  return () => {
    if (overlay.classList && overlay.classList.add) {
      overlay.classList.add('ai-fade-out');
    }
    const timer = typeof setTimeout === 'function' ? setTimeout : (fn) => fn();
    timer(() => {
      if (overlay.remove) overlay.remove();
    }, 300);
  };
}

export async function translateActiveInput(
  doc = typeof document !== 'undefined' ? document : null,
  chromeObj = typeof chrome !== 'undefined' ? chrome : null,
  win = typeof window !== 'undefined' ? window : null
) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);
  const currentWin = win || (typeof window !== 'undefined' ? window : null);

  const alertFn = (msg) => {
    if (currentWin?.alert) currentWin.alert(msg);
  };

  const targetEl = findActiveEditableElement(currentDoc);
  if (!targetEl) {
    alertFn('Спочатку поставте курсор у поле введення (input, textarea або коментар) та напишіть текст.');
    return false;
  }

  const rawText = readEditableText(targetEl);
  if (!rawText || !rawText.trim()) {
    alertFn('Поле введення порожнє. Напишіть текст перед перекладом.');
    return false;
  }

  if (!currentChrome?.runtime?.sendMessage) {
    throw new Error('Chrome runtime messaging is not available');
  }

  const cleanupOverlay = showInputThinkingOverlay(targetEl, currentDoc, currentWin);

  try {
    const res = await currentChrome.runtime.sendMessage({
      type: 'TRANSLATE_INPUT',
      payload: { text: rawText }
    });

    if (!res || !res.ok) {
      throw new Error(res?.error || 'Помилка перекладу поля введення');
    }

    const translated = res.data?.translation;
    if (typeof translated === 'string' && translated.trim()) {
      writeEditableText(targetEl, translated, currentDoc, currentWin);
    }

    return true;
  } catch (err) {
    alertFn(`Помилка перекладу поля: ${err.message}`);
    return false;
  } finally {
    cleanupOverlay();
  }
}
