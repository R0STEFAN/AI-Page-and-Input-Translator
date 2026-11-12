let lastFocusedEditable = null;
let isTranslatingInput = false;

export function resetInputTranslationState() {
  isTranslatingInput = false;
}

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

function getDeepActiveElement(doc) {
  let active = doc?.activeElement || null;
  const seen = new Set();
  while (active && !seen.has(active)) {
    seen.add(active);
    if (active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
      continue;
    }
    break;
  }
  return active;
}

function isElementVisible(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.getAttribute?.('aria-hidden') === 'true') return false;
  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
  }
  return true;
}

function collectEditables(root, results = [], visited = new Set()) {
  if (!root || visited.has(root)) return results;
  visited.add(root);

  if (typeof root.querySelectorAll === 'function') {
    const candidates = root.querySelectorAll('textarea, input, [contenteditable], [role="textbox"]');
    for (const node of candidates) {
      const editable = getEditableTarget(node);
      if (editable && !results.includes(editable)) {
        results.push(editable);
      }
    }
    const allNodes = root.querySelectorAll('*');
    for (const node of allNodes) {
      if (node.shadowRoot) {
        collectEditables(node.shadowRoot, results, visited);
      }
    }
  }
  return results;
}

function findVisibleNonEmptyEditable(doc) {
  const candidates = collectEditables(doc);
  let best = null;
  for (const el of candidates) {
    if (!isElementVisible(el)) continue;
    const text = readEditableText(el).trim();
    if (!text) continue;
    const tag = (el.tagName || '').toUpperCase();
    // Prefer multi-line editors / textareas / contenteditable over single-line search inputs
    if (tag !== 'INPUT') return el;
    if (!best) best = el;
  }
  return best;
}

export function initInputTracker(doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!currentDoc?.addEventListener) return;

  const track = (e) => {
    const rawTarget = typeof e?.composedPath === 'function' ? (e.composedPath()[0] || e?.target) : e?.target;
    const editable = getEditableTarget(rawTarget);
    if (editable) {
      lastFocusedEditable = editable;
    }
  };

  currentDoc.addEventListener('focusin', track, true);
  currentDoc.addEventListener('input', track, true);
  currentDoc.addEventListener('keyup', track, true);
  currentDoc.addEventListener('mousedown', track, true);
}

export function resetLastFocusedEditable() {
  lastFocusedEditable = null;
}

export function findActiveEditableElement(doc = typeof document !== 'undefined' ? document : null) {
  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!currentDoc) return null;

  const deepActive = getDeepActiveElement(currentDoc);
  const active = getEditableTarget(deepActive);
  if (active) return active;

  // If focus stopped on a shadow host (e.g. <shreddit-composer>), inspect inside its shadowRoot
  if (deepActive?.shadowRoot) {
    const shadowCandidate = findVisibleNonEmptyEditable(deepActive.shadowRoot)
      || collectEditables(deepActive.shadowRoot).find(isElementVisible);
    if (shadowCandidate) return shadowCandidate;
  }

  if (lastFocusedEditable && lastFocusedEditable.isConnected !== false) {
    return lastFocusedEditable;
  }

  return findVisibleNonEmptyEditable(currentDoc);
}

export function readEditableText(el) {
  if (!el) return '';
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return el.value || '';
  }
  return (el.innerText !== undefined ? el.innerText : el.textContent) || '';
}

function selectAllContentEditable(el, currentDoc, currentWin) {
  if (!el) return;
  const EventCtor = currentWin?.Event || (typeof Event !== 'undefined' ? Event : null);
  const KeyboardEventCtor = currentWin?.KeyboardEvent || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);

  if (typeof el.focus === 'function') {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  const rootNode = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
  const sel = (typeof rootNode?.getSelection === 'function' ? rootNode.getSelection() : null)
    || (typeof currentWin?.getSelection === 'function' ? currentWin.getSelection() : null);

  if (sel?.removeAllRanges && sel?.addRange && typeof currentDoc?.createRange === 'function') {
    try {
      const range = currentDoc.createRange();
      let placedOnText = false;

      if (typeof currentDoc.createTreeWalker === 'function') {
        const walker = currentDoc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
        let firstText = null;
        let lastText = null;
        let node = walker.nextNode();
        while (node) {
          if (!firstText) firstText = node;
          lastText = node;
          node = walker.nextNode();
        }
        if (firstText && lastText && typeof range.setStart === 'function' && typeof range.setEnd === 'function') {
          range.setStart(firstText, 0);
          range.setEnd(lastText, (lastText.nodeValue || lastText.textContent || '').length);
          placedOnText = true;
        }
      }

      if (!placedOnText && typeof range.selectNodeContents === 'function') {
        range.selectNodeContents(el);
      }

      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  if (typeof currentDoc?.execCommand === 'function') {
    try {
      currentDoc.execCommand('selectAll', false, null);
    } catch {}
  }

  if (KeyboardEventCtor && typeof el.dispatchEvent === 'function') {
    try {
      el.dispatchEvent(new KeyboardEventCtor('keydown', {
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        which: 65,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  if (EventCtor && typeof currentDoc?.dispatchEvent === 'function') {
    try {
      currentDoc.dispatchEvent(new EventCtor('selectionchange'));
    } catch {}
  }
}

export function isRichTextEditor(el) {
  if (!el) return false;
  if (typeof el.closest === 'function') {
    if (el.closest('shreddit-composer, [data-lexical-editor], [data-slate-editor], .ProseMirror, [data-editor], .DraftEditor-root, .ql-editor')) {
      return true;
    }
  }
  if (el.hasAttribute?.('data-lexical-editor') ||
      el.hasAttribute?.('data-slate-editor') ||
      el.classList?.contains?.('ProseMirror') ||
      el.classList?.contains?.('ql-editor') ||
      el.classList?.contains?.('DraftEditor-root')) {
    return true;
  }
  if (el.getAttribute?.('role') === 'textbox' && (el.isContentEditable === true || el.getAttribute?.('contenteditable') === 'true')) {
    return true;
  }
  const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
  if (root && root.host) {
    const hostTag = (root.host.tagName || '').toLowerCase();
    if (hostTag.includes('composer') || hostTag.includes('editor')) {
      return true;
    }
  }
  return false;
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

  const tag = el.tagName?.toUpperCase();
  const EventCtor = currentWin?.Event || (typeof Event !== 'undefined' ? Event : null);
  const InputEventCtor = currentWin?.InputEvent || EventCtor;

  if (typeof el.focus === 'function') {
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    let execOk = false;
    const len = (el.value || '').length;
    if (typeof el.select === 'function') {
      try { el.select(); } catch {}
    }
    if (typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(0, len); } catch {}
    }
    if (typeof currentDoc?.execCommand === 'function') {
      try {
        currentDoc.execCommand('selectAll', false, null);
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

      if (typeof el.dispatchEvent === 'function') {
        if (InputEventCtor) {
          try {
            el.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertReplacementText', data: translatedText }));
          } catch {
            if (EventCtor) el.dispatchEvent(new EventCtor('input', { bubbles: true }));
          }
        } else if (EventCtor) {
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
  const readText = () => (el.innerText !== undefined ? el.innerText : el.textContent) || '';

  // Select all content before replacing
  selectAllContentEditable(el, currentDoc, currentWin);

  const ClipboardEventCtor = currentWin?.ClipboardEvent || (typeof ClipboardEvent !== 'undefined' ? ClipboardEvent : null);
  const DataTransferCtor = currentWin?.DataTransfer || (typeof DataTransfer !== 'undefined' ? DataTransfer : null);

  const dispatchPaste = () => {
    if (!ClipboardEventCtor || !DataTransferCtor || typeof el.dispatchEvent !== 'function') return false;
    try {
      const dt = new DataTransferCtor();
      dt.setData('text/plain', translatedText);
      const pasteEvent = new ClipboardEventCtor('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      });
      el.dispatchEvent(pasteEvent);
      return true;
    } catch {
      return false;
    }
  };

  // If this is a known modern rich-text editor (Lexical/Reddit, ProseMirror, Slate, Draft.js, role="textbox"):
  // ALWAYS use paste event exclusively. Calling execCommand('insertText') causes Lexical to duplicate text!
  if (isRichTextEditor(el)) {
    if (dispatchPaste()) {
      return true;
    }
  }

  // For standard/vanilla contenteditable:
  if (typeof currentDoc?.execCommand === 'function') {
    try {
      currentDoc.execCommand('delete', false, null);
    } catch {}
  }

  let execOk = false;
  if (typeof currentDoc?.execCommand === 'function') {
    try {
      execOk = Boolean(currentDoc.execCommand('insertText', false, translatedText));
    } catch {
      execOk = false;
    }
  }

  let currentVal = readText();
  if (execOk || currentVal.trim() === translatedText.trim()) {
    return true;
  }

  // Fallback: only if execCommand failed AND the text is not yet present
  if (!currentVal.includes(translatedText)) {
    if (dispatchPaste()) {
      currentVal = readText();
      if (currentVal.trim() === translatedText.trim() || currentVal.includes(translatedText)) {
        return true;
      }
    }
  }

  currentVal = readText();
  if (currentVal.trim() !== translatedText.trim() && !currentVal.includes(translatedText)) {
    if (el.innerText !== undefined) {
      el.innerText = translatedText;
    } else {
      el.textContent = translatedText;
    }

    if (typeof el.dispatchEvent === 'function') {
      if (InputEventCtor) {
        try {
          el.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertReplacementText', data: translatedText }));
        } catch {
          if (EventCtor) el.dispatchEvent(new EventCtor('input', { bubbles: true }));
        }
      } else if (EventCtor) {
        el.dispatchEvent(new EventCtor('input', { bubbles: true }));
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
  if (isTranslatingInput) return false;
  isTranslatingInput = true;

  const currentDoc = doc || (typeof document !== 'undefined' ? document : null);
  const currentChrome = chromeObj || (typeof chrome !== 'undefined' ? chrome : null);
  const currentWin = win || (typeof window !== 'undefined' ? window : null);

  const alertFn = (msg) => {
    if (currentWin?.alert) currentWin.alert(msg);
  };

  let cleanupOverlay = () => {};

  try {
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

    cleanupOverlay = showInputThinkingOverlay(targetEl, currentDoc, currentWin);

    const res = await currentChrome.runtime.sendMessage({
      type: 'TRANSLATE_INPUT',
      payload: { text: rawText }
    });

    if (!res || !res.ok) {
      throw new Error(res?.error || 'Помилка перекладу поля введення');
    }

    const translated = res.data?.translation;
    if (typeof translated === 'string' && translated.trim()) {
      const tag = (targetEl.tagName || '').toUpperCase();
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && typeof setTimeout === 'function') {
        // Pre-select and yield one macrotask so rich editors (e.g. Lexical/Reddit) sync selectionchange before replace
        selectAllContentEditable(targetEl, currentDoc, currentWin);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      writeEditableText(targetEl, translated, currentDoc, currentWin);
    }

    return true;
  } catch (err) {
    alertFn(`Помилка перекладу поля: ${err.message}`);
    return false;
  } finally {
    cleanupOverlay();
    isTranslatingInput = false;
  }
}
