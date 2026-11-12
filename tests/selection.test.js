import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSelectionTranslation, normalizeNewlines } from '../content/selection.js';
import { translateMainContent, handleContentMessage, BATCH_SIZE } from '../content/content.js';

// Helper for Mock DOM nodes
class MockNode {
  constructor(nodeType, text = '') {
    this.nodeType = nodeType; // 1 = Element, 3 = Text
    this.textContent = text;
    this.innerText = text;
    this.parentElement = null;
    this.parentNode = null;
    this.children = [];
    this.childNodes = [];
    this.dataset = {};
    this.className = '';
    this.title = '';
    this.tagName = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
    this.eventListeners = new Map();
  }

  addEventListener(type, fn) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(fn);
  }

  dispatchEvent(event) {
    const list = this.eventListeners.get(event.type) || [];
    for (const fn of list) {
      fn(event);
    }
  }

  replaceWith(...nodes) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const idx = parent.childNodes.indexOf(this);
    if (idx !== -1) {
      parent.childNodes.splice(idx, 1, ...nodes);
      for (const n of nodes) {
        n.parentElement = parent;
        n.parentNode = parent;
      }
      parent.children = parent.childNodes.filter(n => n.nodeType === 1);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.childNodes.push(child);
    if (child.nodeType === 1) {
      this.children.push(child);
    }
    return child;
  }
}

class MockRange {
  constructor(containerNode, selectedText) {
    this.container = containerNode;
    this.selectedText = selectedText;
    this.deleted = false;
    this.insertedNode = null;
  }

  deleteContents() {
    this.deleted = true;
    this.container.textContent = '';
    this.container.innerText = '';
    this.container.childNodes = [];
    this.container.children = [];
  }

  insertNode(node) {
    this.insertedNode = node;
    this.container.appendChild(node);
  }
}

class MockSelection {
  constructor(range, text) {
    this._range = range;
    this._text = text;
    this.rangeCount = range ? 1 : 0;
    this.removedAllRanges = false;
  }

  getRangeAt(idx) {
    if (idx === 0 && this._range) return this._range;
    return null;
  }

  toString() {
    return this._text || '';
  }

  removeAllRanges() {
    this.removedAllRanges = true;
    this.rangeCount = 0;
  }
}

function createMockEnvironment(selectedText = '') {
  const container = new MockNode(1, selectedText);
  container.tagName = 'P';

  const doc = {
    body: new MockNode(1),
    createElement: (tag) => {
      const el = new MockNode(1);
      el.tagName = tag.toUpperCase();
      return el;
    },
    createTextNode: (text) => {
      return new MockNode(3, text);
    },
    querySelectorAll: (sel) => [],
    querySelector: (sel) => null
  };
  doc.body.tagName = 'BODY';
  doc.body.appendChild(container);

  const range = new MockRange(container, selectedText);
  const selection = new MockSelection(range, selectedText);

  const win = {
    document: doc,
    getSelection: () => selection,
    alert: (msg) => {}
  };

  const sentMessages = [];
  const chromeObj = {
    runtime: {
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        if (msg.type === 'TRANSLATE_SELECTION') {
          return {
            ok: true,
            data: { translation: `[ПЕРЕКЛАДЕНО: ${msg.payload.text}]` }
          };
        }
        if (msg.type === 'TRANSLATE_BATCH') {
          return {
            ok: true,
            data: { translations: msg.payload.texts.map(t => `[TR] ${t}`) }
          };
        }
        return { ok: false, error: 'Unknown message type' };
      }
    }
  };

  return { win, doc, container, range, selection, chromeObj, sentMessages };
}

// -------------------------------------------------------------
// Tests for content/selection.js
// -------------------------------------------------------------

test('handleSelectionTranslation returns early if selection is null or rangeCount is 0', async () => {
  const env = createMockEnvironment('Hello world');
  env.win.getSelection = () => null;

  await handleSelectionTranslation(env.win, env.chromeObj);
  assert.equal(env.sentMessages.length, 0);

  const zeroRangeSelection = new MockSelection(null, '');
  zeroRangeSelection.rangeCount = 0;
  env.win.getSelection = () => zeroRangeSelection;

  await handleSelectionTranslation(env.win, env.chromeObj);
  assert.equal(env.sentMessages.length, 0);
});

test('handleSelectionTranslation returns early if selected text length < 2 or empty', async () => {
  const env1 = createMockEnvironment('');
  await handleSelectionTranslation(env1.win, env1.chromeObj);
  assert.equal(env1.sentMessages.length, 0);

  const env2 = createMockEnvironment('a');
  await handleSelectionTranslation(env2.win, env2.chromeObj);
  assert.equal(env2.sentMessages.length, 0);

  const env3 = createMockEnvironment('   \n  ');
  await handleSelectionTranslation(env3.win, env3.chromeObj);
  assert.equal(env3.sentMessages.length, 0);
});

test('handleSelectionTranslation replaces range with temporary pulse span during translation', async () => {
  const env = createMockEnvironment('Selecting this sentence');
  let pulseSpanObserved = false;

  // Intercept sendMessage to inspect DOM while translation is pending
  env.chromeObj.runtime.sendMessage = async (msg) => {
    env.sentMessages.push(msg);
    const pulseSpan = env.container.childNodes[0];
    if (
      pulseSpan &&
      pulseSpan.className === 'ai-translating-pulse' &&
      pulseSpan.textContent === 'Selecting this sentence'
    ) {
      pulseSpanObserved = true;
    }
    return {
      ok: true,
      data: { translation: 'Виділяючи це речення' }
    };
  };

  await handleSelectionTranslation(env.win, env.chromeObj);

  assert.ok(env.range.deleted, 'Range contents should be deleted');
  assert.ok(env.selection.removedAllRanges, 'Selection should remove all ranges');
  assert.ok(pulseSpanObserved, 'Temporary pulse span should have existed during translation');
  assert.equal(env.sentMessages.length, 1);
  assert.deepEqual(env.sentMessages[0], {
    type: 'TRANSLATE_SELECTION',
    payload: { text: 'Selecting this sentence' }
  });
});

test('handleSelectionTranslation replaces placeholder with translated span on success', async () => {
  const env = createMockEnvironment('Hello brave world');

  await handleSelectionTranslation(env.win, env.chromeObj);

  assert.equal(env.container.childNodes.length, 1);
  const translatedSpan = env.container.childNodes[0];
  assert.equal(translatedSpan.nodeType, 1);
  assert.equal(translatedSpan.className, 'ai-translated-selection');
  assert.equal(translatedSpan.textContent, '[ПЕРЕКЛАДЕНО: Hello brave world]');
  assert.equal(translatedSpan.title, 'Клікніть, щоб повернути оригінал');
  assert.equal(translatedSpan.dataset.original, 'Hello brave world');
});

test('handleSelectionTranslation restores original text on click of translated span', async () => {
  const env = createMockEnvironment('Interactive selection test');

  await handleSelectionTranslation(env.win, env.chromeObj);

  const translatedSpan = env.container.childNodes[0];
  assert.equal(translatedSpan.className, 'ai-translated-selection');

  let propagationStopped = false;
  translatedSpan.dispatchEvent({
    type: 'click',
    stopPropagation: () => {
      propagationStopped = true;
    }
  });

  assert.ok(propagationStopped, 'Click handler must stop event propagation');
  assert.equal(env.container.childNodes.length, 1);
  const restoredNode = env.container.childNodes[0];
  assert.equal(restoredNode.nodeType, 3, 'Restored node must be a TextNode');
  assert.equal(restoredNode.textContent, 'Interactive selection test');
});

test('handleSelectionTranslation handles translation error: alerts and restores original text node', async () => {
  const env = createMockEnvironment('Error prone text');
  const alertMessages = [];
  const alertFn = (msg) => alertMessages.push(msg);

  env.chromeObj.runtime.sendMessage = async () => {
    return { ok: false, error: 'Network timeout occurred' };
  };

  await handleSelectionTranslation(env.win, env.chromeObj, alertFn);

  assert.equal(alertMessages.length, 1);
  assert.equal(alertMessages[0], 'Помилка перекладу виділеного: Network timeout occurred');

  assert.equal(env.container.childNodes.length, 1);
  const revertedNode = env.container.childNodes[0];
  assert.equal(revertedNode.nodeType, 3, 'Should revert back to TextNode');
  assert.equal(revertedNode.textContent, 'Error prone text');
});

test('normalizeNewlines converts literal \\n, \\r, \\t and normalizes CRLF', () => {
  assert.equal(normalizeNewlines('Line1\\n\\nLine2'), 'Line1\n\nLine2');
  assert.equal(normalizeNewlines('Line1\\r\\nLine2'), 'Line1\nLine2');
  assert.equal(normalizeNewlines('Tab\\tSpace'), 'Tab\tSpace');
  assert.equal(normalizeNewlines(null), '');
  assert.equal(normalizeNewlines(undefined), '');
});

test('handleSelectionTranslation creates restore button at end and preserves multi-line breaks', async () => {
  const multiLineOriginal = 'First paragraph\\n\\nSecond paragraph';
  const env = createMockEnvironment(multiLineOriginal);

  env.chromeObj.runtime.sendMessage = async () => ({
    ok: true,
    data: { translation: 'Перший абзац\\n\\nДругий абзац' }
  });

  await handleSelectionTranslation(env.win, env.chromeObj);

  const translatedSpan = env.container.childNodes[0];
  assert.equal(translatedSpan.className, 'ai-translated-selection');
  assert.equal(translatedSpan.textContent, 'Перший абзац\n\nДругий абзац');
  assert.ok(translatedSpan.childNodes.length >= 1, 'Should contain restore button child');

  const restoreBtn = translatedSpan.childNodes.find(c => c.className === 'ai-restore-selection-btn');
  assert.ok(restoreBtn, 'Restore button must be present in translated span');
  assert.equal(restoreBtn.title, 'Повернути оригінал');

  // Trigger restore via button
  let propagationStopped = false;
  restoreBtn.dispatchEvent({
    type: 'click',
    stopPropagation: () => { propagationStopped = true; }
  });

  assert.ok(propagationStopped);
  const restored = env.container.childNodes[0];
  assert.equal(restored.textContent, 'First paragraph\n\nSecond paragraph');
});

// -------------------------------------------------------------
// Tests for content/content.js
// -------------------------------------------------------------

test('BATCH_SIZE is exported and equals 15', () => {
  assert.equal(BATCH_SIZE, 15);
});

test('handleContentMessage returns false for empty or invalid messages', () => {
  let called = false;
  const result = handleContentMessage(null, {}, () => { called = true; });
  assert.equal(result, false);
  assert.equal(called, false);
});

test('handleContentMessage handles GET_PAGE_STATUS correctly', () => {
  const env = createMockEnvironment();

  // 1. When page is not translated
  let statusResponse = null;
  const res1 = handleContentMessage(
    { action: 'GET_PAGE_STATUS' },
    {},
    (res) => { statusResponse = res; },
    env.doc,
    env.chromeObj
  );
  assert.equal(res1, false);
  assert.deepEqual(statusResponse, { ok: true, isTranslated: false });

  // 2. When page is marked as translated
  env.doc.body.dataset.aiPageTranslated = 'true';
  let statusResponse2 = null;
  const res2 = handleContentMessage(
    { action: 'GET_PAGE_STATUS' },
    {},
    (res) => { statusResponse2 = res; },
    env.doc,
    env.chromeObj
  );
  assert.equal(res2, false);
  assert.deepEqual(statusResponse2, { ok: true, isTranslated: true });
});

test('handleContentMessage handles TRIGGER_SELECTION_TRANSLATION', () => {
  const env = createMockEnvironment('Selected test');
  let response = null;

  const res = handleContentMessage(
    { action: 'TRIGGER_SELECTION_TRANSLATION' },
    {},
    (r) => { response = r; },
    env.doc,
    env.chromeObj,
    env.win
  );

  assert.equal(res, false);
  assert.deepEqual(response, { ok: true });
});

test('handleContentMessage handles RESTORE_ORIGINAL_CONTENT', () => {
  const env = createMockEnvironment();
  env.doc.body.dataset.aiPageTranslated = 'true';

  // Setup a mock translated element
  const translatedP = env.doc.createElement('p');
  translatedP.innerText = 'Restored paragraph';
  translatedP.dataset.aiOriginalText = 'Original paragraph';
  translatedP.classList.add('ai-translated-block');
  env.doc.querySelectorAll = (sel) => {
    if (sel.includes('[data-ai-original-text]')) return [translatedP];
    return [];
  };

  let response = null;
  const res = handleContentMessage(
    { action: 'RESTORE_ORIGINAL_CONTENT' },
    {},
    (r) => { response = r; },
    env.doc,
    env.chromeObj
  );

  assert.equal(res, false);
  assert.deepEqual(response, { ok: true });
  assert.equal(env.doc.body.dataset.aiPageTranslated, undefined);
  assert.equal(translatedP.innerText, 'Original paragraph');
  assert.equal(translatedP.classList.contains('ai-translated-block'), false);
});

test('translateMainContent throws error when no text elements are found', async () => {
  const env = createMockEnvironment();
  env.doc.body.innerText = 'Very short';
  env.doc.querySelector = () => null;
  env.doc.querySelectorAll = () => [];

  await assert.rejects(
    async () => {
      await translateMainContent(null, env.doc, env.chromeObj);
    },
    {
      name: 'Error',
      message: 'Не знайдено текстових блоків для перекладу'
    }
  );
});

test('translateMainContent translates elements in batches of 15 and fires progress', async () => {
  const env = createMockEnvironment();

  // Create a main container with 35 paragraphs
  const mainEl = env.doc.createElement('main');
  const paragraphs = [];
  for (let i = 0; i < 35; i++) {
    const p = env.doc.createElement('p');
    p.tagName = 'P';
    p.innerText = `Paragraph text number ${i + 1} that is sufficiently long`;
    p.closest = () => null;
    p.querySelector = () => null;
    paragraphs.push(p);
    mainEl.appendChild(p);
  }

  env.doc.querySelector = (sel) => {
    if (sel.includes('main')) return mainEl;
    return null;
  };
  mainEl.innerText = 'x'.repeat(400); // Exceeds 300 char threshold
  mainEl.querySelectorAll = (sel) => {
    if (sel.includes('p')) return paragraphs;
    return [];
  };

  const progressUpdates = [];
  const progressCallback = (done, total) => {
    progressUpdates.push({ done, total });
  };

  await translateMainContent(progressCallback, env.doc, env.chromeObj);

  // Verification:
  // 1. dataset.aiPageTranslated set
  assert.equal(env.doc.body.dataset.aiPageTranslated, 'true');

  // 2. Sent messages: 35 elements in batches of 15 => 3 batches (15, 15, 5)
  assert.equal(env.sentMessages.length, 3);
  assert.equal(env.sentMessages[0].payload.texts.length, 15);
  assert.equal(env.sentMessages[1].payload.texts.length, 15);
  assert.equal(env.sentMessages[2].payload.texts.length, 5);

  // 3. Progress callback updates
  assert.deepEqual(progressUpdates, [
    { done: 15, total: 35 },
    { done: 30, total: 35 },
    { done: 35, total: 35 }
  ]);

  // 4. Batch replacement applied
  assert.equal(paragraphs[0].innerText, '[TR] Paragraph text number 1 that is sufficiently long');
  assert.equal(paragraphs[0].classList.contains('ai-translated-block'), true);
});

test('handleContentMessage async TRANSLATE_MAIN_CONTENT handles success and progress reporting', async () => {
  const env = createMockEnvironment();

  const mainEl = env.doc.createElement('main');
  const p = env.doc.createElement('p');
  p.tagName = 'P';
  p.innerText = 'A single translatable paragraph in main content';
  p.closest = () => null;
  p.querySelector = () => null;
  mainEl.appendChild(p);
  mainEl.innerText = 'x'.repeat(400);
  mainEl.querySelectorAll = () => [p];

  env.doc.querySelector = (sel) => {
    if (sel.includes('main')) return mainEl;
    return null;
  };

  let finalResponse = null;
  const isAsync = handleContentMessage(
    { action: 'TRANSLATE_MAIN_CONTENT' },
    {},
    (res) => { finalResponse = res; },
    env.doc,
    env.chromeObj
  );

  assert.equal(isAsync, true, 'Must return true to keep message channel open');

  // Wait for async processing
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(finalResponse, { ok: true });
  // Verify progress message was dispatched to chrome.runtime.sendMessage
  const progressMsg = env.sentMessages.find(m => m.type === 'PAGE_TRANSLATION_PROGRESS');
  assert.ok(progressMsg, 'PAGE_TRANSLATION_PROGRESS must be dispatched');
  assert.deepEqual(progressMsg, {
    type: 'PAGE_TRANSLATION_PROGRESS',
    done: 1,
    total: 1
  });
});

test('handleContentMessage async TRANSLATE_MAIN_CONTENT handles errors gracefully', async () => {
  const env = createMockEnvironment();
  // No translatable elements => will trigger error
  env.doc.querySelector = () => null;
  env.doc.querySelectorAll = () => [];

  let finalResponse = null;
  const isAsync = handleContentMessage(
    { action: 'TRANSLATE_MAIN_CONTENT' },
    {},
    (res) => { finalResponse = res; },
    env.doc,
    env.chromeObj
  );

  assert.equal(isAsync, true);

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(finalResponse, {
    ok: false,
    error: 'Не знайдено текстових блоків для перекладу'
  });
});

test('handleSelectionTranslation works with globals when parameters are omitted', async () => {
  const env = createMockEnvironment('Global selection fallback');
  globalThis.window = env.win;
  globalThis.document = env.doc;
  globalThis.chrome = env.chromeObj;

  try {
    await handleSelectionTranslation();
    assert.equal(env.container.childNodes.length, 1);
    const translatedSpan = env.container.childNodes[0];
    assert.equal(translatedSpan.className, 'ai-translated-selection');
    assert.equal(translatedSpan.textContent, '[ПЕРЕКЛАДЕНО: Global selection fallback]');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
  }
});

test('handleContentMessage works with globals when parameters are omitted', () => {
  const env = createMockEnvironment();
  env.doc.body.dataset.aiPageTranslated = 'true';
  globalThis.document = env.doc;
  globalThis.chrome = env.chromeObj;

  try {
    let response = null;
    const handled = handleContentMessage({ action: 'GET_PAGE_STATUS' }, {}, (r) => { response = r; });
    assert.equal(handled, false);
    assert.deepEqual(response, { ok: true, isTranslated: true });
  } finally {
    delete globalThis.document;
    delete globalThis.chrome;
  }
});

test('translateMainContent halts immediately if user restores original text during batch processing', async () => {
  const env = createMockEnvironment();

  // Create a main container with 30 paragraphs (2 batches of 15)
  const mainEl = env.doc.createElement('main');
  const paragraphs = [];
  for (let i = 0; i < 30; i++) {
    const p = env.doc.createElement('p');
    p.tagName = 'P';
    p.innerText = `Original paragraph ${i + 1}`;
    p.closest = () => null;
    p.querySelector = () => null;
    paragraphs.push(p);
    mainEl.appendChild(p);
  }

  env.doc.querySelector = (sel) => {
    if (sel.includes('main')) return mainEl;
    return null;
  };
  mainEl.innerText = 'x'.repeat(400);
  mainEl.querySelectorAll = (sel) => {
    if (sel.includes('p')) return paragraphs;
    return [];
  };

  let batchCount = 0;
  env.chromeObj.runtime.sendMessage = async (msg) => {
    if (msg.type === 'TRANSLATE_BATCH') {
      batchCount++;
      // On the first batch response, simulate the user hitting "restore"
      delete env.doc.body.dataset.aiPageTranslated;
      return {
        ok: true,
        data: { translations: msg.payload.texts.map(t => `[TR] ${t}`) }
      };
    }
    return { ok: false };
  };

  await translateMainContent(null, env.doc, env.chromeObj);

  // Since aiPageTranslated was deleted during batch 1, batch 1 should not overwrite
  // and batch 2 should never even execute
  assert.equal(batchCount, 1, 'Should stop after first batch and not process second batch');
  // Paragraph 16 (in batch 2) must remain original
  assert.equal(paragraphs[15].innerText, 'Original paragraph 16');
  assert.equal(paragraphs[15].classList.contains('ai-translated-block'), false);
});

