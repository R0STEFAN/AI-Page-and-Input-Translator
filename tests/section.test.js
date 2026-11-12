import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSectionContainer, startSectionInspector, stopSectionInspector } from '../content/inspector.js';
import { attachSectionRestoreBadge, restoreOriginalText } from '../content/replacer.js';
import { translateSection, handleContentMessage } from '../content/content.js';
import { initPopup } from '../popup/popup.js';

class MockDOMElement {
  constructor(tagName = 'div', text = '') {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this._html = text;
    this._className = '';
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.parentElement = null;
    this.parentNode = null;
    this.children = [];
    this.childNodes = [];
    this.attributes = new Map();
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
    this.eventListeners = new Map();
  }

  get innerText() {
    return this._text || '';
  }

  set innerText(val) {
    this._text = val;
    this._html = val;
  }

  get innerHTML() {
    return this._html || '';
  }

  set innerHTML(val) {
    this._html = val;
    this._text = val;
  }

  get className() {
    return this._className || '';
  }

  set className(val) {
    this._className = val || '';
    this.classList._classes.clear();
    (val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  addEventListener(type, fn) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.eventListeners.get(type) || [];
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const list = this.eventListeners.get(event.type) || [];
    for (const fn of list) {
      fn(event);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    child.parentNode = this;
    this.childNodes.push(child);
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.childNodes.indexOf(this);
      if (idx !== -1) this.parentElement.childNodes.splice(idx, 1);
      const cIdx = this.parentElement.children.indexOf(this);
      if (cIdx !== -1) this.parentElement.children.splice(cIdx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector) {
    for (const child of this.childNodes) {
      if (selector.startsWith('.') && child.classList?.contains(selector.slice(1))) {
        return child;
      }
      if (selector.startsWith('#') && child.id === selector.slice(1)) {
        return child;
      }
      if (child.querySelector) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const selectors = selector.split(',').map(s => s.trim());
    const matchSelector = (child, sel) => {
      if (sel.startsWith('.') && child.classList?.contains(sel.slice(1))) return true;
      if (sel.startsWith('#') && child.id === sel.slice(1)) return true;
      if (sel === '[data-ai-original-text]' && child.dataset?.aiOriginalText !== undefined) return true;
      if (sel === '[data-ai-original-html]' && child.dataset?.aiOriginalHtml !== undefined) return true;
      if (child.tagName?.toLowerCase() === sel.toLowerCase()) return true;
      return false;
    };
    const walk = (node) => {
      for (const child of node.childNodes || []) {
        if (selectors.some(sel => matchSelector(child, sel))) {
          results.push(child);
        }
        if (child.childNodes && child.childNodes.length > 0) {
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  closest(selector) {
    let curr = this;
    const selectors = selector.split(',').map(s => s.trim());
    while (curr) {
      for (const sel of selectors) {
        if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
        if (sel.startsWith('.') && curr.classList?.contains(sel.slice(1))) return curr;
        if (curr.tagName?.toLowerCase() === sel.toLowerCase()) return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return { top: 50, left: 100, width: 400, height: 250 };
  }
}

class MockDocument {
  constructor() {
    this.documentElement = new MockDOMElement('html');
    this.body = new MockDOMElement('body');
    this.documentElement.appendChild(this.body);
    this.eventListeners = new Map();
  }

  createElement(tag) {
    return new MockDOMElement(tag);
  }

  getElementById(id) {
    return this.body.querySelector(`#${id}`);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  addEventListener(type, fn, useCapture) {
    const key = `${type}_${Boolean(useCapture)}`;
    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, []);
    }
    this.eventListeners.get(key).push(fn);
  }

  removeEventListener(type, fn, useCapture) {
    const key = `${type}_${Boolean(useCapture)}`;
    const list = this.eventListeners.get(key) || [];
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  triggerDocEvent(type, eventObj, useCapture = true) {
    const key = `${type}_${Boolean(useCapture)}`;
    const list = this.eventListeners.get(key) || [];
    for (const fn of list) {
      fn(eventObj);
    }
  }

  elementFromPoint(x, y) {
    return this._targetPointElement || null;
  }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

test('findSectionContainer returns null for null, body, html, or extension overlays', () => {
  const doc = new MockDocument();
  assert.equal(findSectionContainer(null, doc), null);
  assert.equal(findSectionContainer(doc.body, doc), null);
  assert.equal(findSectionContainer(doc.documentElement, doc), null);

  const highlighter = new MockDOMElement('div');
  highlighter.id = 'ai-section-highlighter';
  doc.body.appendChild(highlighter);
  assert.equal(findSectionContainer(highlighter, doc), null);
});

test('findSectionContainer bubbles up to semantic section or article container', () => {
  const doc = new MockDocument();
  const article = new MockDOMElement('article', 'This is a long article block with plenty of words to translate.');
  const divWrapper = new MockDOMElement('div', 'Inner text content');
  const span = new MockDOMElement('span', 'Inner text content');
  article.appendChild(divWrapper);
  divWrapper.appendChild(span);
  doc.body.appendChild(article);

  const container = findSectionContainer(span, doc);
  assert.equal(container, article);
});

test('findSectionContainer selects div container with sufficient text length', () => {
  const doc = new MockDocument();
  const cardDiv = new MockDOMElement('div', 'Here is a significant container div with plenty of useful text content.');
  const p = new MockDOMElement('p', 'Paragraph inside');
  cardDiv.appendChild(p);
  doc.body.appendChild(cardDiv);

  const container = findSectionContainer(p, doc);
  assert.equal(container, cardDiv);
});

test('startSectionInspector creates highlighter overlay and handles hover, click, and cancel', () => {
  const doc = new MockDocument();
  const section = new MockDOMElement('section', 'Section content with enough text to inspect.');
  doc.body.appendChild(section);
  doc._targetPointElement = section;

  let selected = null;
  const inspector = startSectionInspector((el) => {
    selected = el;
  }, doc, { pageXOffset: 0, pageYOffset: 0 });

  assert.ok(inspector, 'Inspector instance returned');
  const highlighter = doc.getElementById('ai-section-highlighter');
  assert.ok(highlighter, 'Highlighter element should be added to DOM');
  assert.equal(highlighter.className, 'ai-section-highlighter');

  // Simulate mouse movement
  doc.triggerDocEvent('mousemove', { clientX: 120, clientY: 80 }, true);
  assert.equal(highlighter.style.display, 'block');
  assert.equal(highlighter.style.top, '50px');
  assert.equal(highlighter.style.left, '100px');

  // Simulate click selection
  let prevented = false;
  let stopped = false;
  doc.triggerDocEvent('click', {
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
    stopImmediatePropagation: () => {}
  }, true);

  assert.ok(prevented, 'Click event default must be prevented');
  assert.ok(stopped, 'Click event propagation must be stopped');
  assert.equal(selected, section, 'Selected section passed to callback');
  assert.equal(highlighter.style.display, 'none', 'Highlighter hidden after selection');
});

test('startSectionInspector handles Escape key cancel', () => {
  const doc = new MockDocument();
  const p = new MockDOMElement('p', 'Some paragraph text.');
  doc.body.appendChild(p);

  let selected = null;
  startSectionInspector((el) => { selected = el; }, doc);

  const highlighter = doc.getElementById('ai-section-highlighter');
  assert.ok(highlighter);

  // Press Escape
  doc.triggerDocEvent('keydown', { key: 'Escape' }, true);
  assert.equal(selected, null, 'Nothing selected on Escape');
  assert.equal(highlighter.style.display, 'none', 'Highlighter hidden on Escape');
});

test('attachSectionRestoreBadge adds floating button and restores section on click', () => {
  const doc = new MockDocument();
  const section = new MockDOMElement('section');
  const p1 = new MockDOMElement('p', 'Перекладений абзац 1');
  p1.dataset.aiOriginalHtml = 'Original paragraph 1';
  p1.classList.add('ai-translated-block');
  const p2 = new MockDOMElement('p', 'Перекладений абзац 2');
  p2.dataset.aiOriginalHtml = 'Original paragraph 2';
  p2.classList.add('ai-translated-block');

  section.appendChild(p1);
  section.appendChild(p2);
  doc.body.appendChild(section);

  const badge = attachSectionRestoreBadge(section, [p1, p2], doc);
  assert.ok(badge, 'Badge created');
  assert.equal(badge.className, 'ai-section-restore-badge');
  assert.equal(section.style.position, 'relative', 'Section positioned relative');
  assert.ok(section.childNodes.includes(badge), 'Badge attached to section');

  // Click badge
  let stopped = false;
  badge.dispatchEvent({
    type: 'click',
    stopPropagation: () => { stopped = true; }
  });

  assert.ok(stopped, 'Click stopped propagation');
  assert.equal(p1.innerHTML, 'Original paragraph 1');
  assert.equal(p2.innerHTML, 'Original paragraph 2');
  assert.ok(!p1.classList.contains('ai-translated-block'));
  assert.ok(!p2.classList.contains('ai-translated-block'));
  assert.equal(p1.dataset.aiOriginalHtml, undefined);
  assert.equal(p2.dataset.aiOriginalHtml, undefined);
});

test('restoreOriginalText also cleans up any active .ai-section-restore-badge elements', () => {
  const doc = new MockDocument();
  const p = new MockDOMElement('p', 'Перекладено');
  p.dataset.aiOriginalText = 'Original';
  p.classList.add('ai-translated-block');
  const badge = new MockDOMElement('button');
  badge.classList.add('ai-section-restore-badge');
  doc.body.appendChild(p);
  doc.body.appendChild(badge);

  restoreOriginalText(doc);
  assert.equal(p.innerText, 'Original');
  assert.equal(doc.body.childNodes.includes(badge), false, 'Badge removed from body');
});

test('translateSection translates elements inside container and attaches restore badge', async () => {
  const doc = new MockDocument();
  const section = new MockDOMElement('article');
  const p1 = new MockDOMElement('p', 'Hello world');
  const p2 = new MockDOMElement('p', 'Welcome to the test');
  section.appendChild(p1);
  section.appendChild(p2);
  doc.body.appendChild(section);

  const sentMessages = [];
  const mockChrome = {
    runtime: {
      sendMessage: async (msg) => {
        sentMessages.push(msg);
        if (msg.type === 'TRANSLATE_BATCH') {
          return {
            ok: true,
            data: {
              translations: msg.payload.texts.map(t => `[UK] ${t}`)
            }
          };
        }
        return { ok: true };
      }
    }
  };

  const progressUpdates = [];
  const translated = await translateSection(
    section,
    (done, total) => { progressUpdates.push({ done, total }); },
    doc,
    mockChrome
  );

  assert.equal(translated.length, 2);
  assert.equal(p1.innerText, '[UK] Hello world');
  assert.equal(p2.innerText, '[UK] Welcome to the test');
  assert.ok(progressUpdates.length > 0);

  const badge = section.querySelector('.ai-section-restore-badge');
  assert.ok(badge, 'Badge attached to section after translation');
});

test('handleContentMessage starts section inspector on START_SECTION_INSPECTOR message', () => {
  const doc = new MockDocument();
  let responseData = null;
  const sendResponse = (res) => { responseData = res; };

  const handled = handleContentMessage(
    { action: 'START_SECTION_INSPECTOR' },
    {},
    sendResponse,
    doc,
    null,
    null
  );

  assert.equal(handled, false);
  assert.deepEqual(responseData, { ok: true });
  const highlighter = doc.getElementById('ai-section-highlighter');
  assert.ok(highlighter, 'Highlighter created on inspector start');
});

test('popup selectSectionBtn triggers START_SECTION_INSPECTOR and closes window', async () => {
  const doc = new MockDocument();
  const btn = doc.createElement('button');
  btn.id = 'selectSectionBtn';
  const toggleBtn = doc.createElement('button');
  toggleBtn.id = 'toggleTranslateBtn';
  const engineBadge = doc.createElement('span');
  engineBadge.id = 'engineBadge';
  const langBadge = doc.createElement('span');
  langBadge.id = 'langBadge';
  const alertBox = doc.createElement('div');
  alertBox.id = 'alertBox';
  alertBox.classList.add('hidden');

  doc.body.appendChild(btn);
  doc.body.appendChild(toggleBtn);
  doc.body.appendChild(engineBadge);
  doc.body.appendChild(langBadge);
  doc.body.appendChild(alertBox);

  const sentTabMessages = [];
  let closed = false;

  const originalWindow = globalThis.window;
  globalThis.window = { close: () => { closed = true; } };

  try {
    const mockChrome = {
      tabs: {
        query: async () => [{ id: 42 }],
        sendMessage: async (tabId, msg) => {
          sentTabMessages.push({ tabId, msg });
          return { ok: true };
        }
      },
      runtime: {
        sendMessage: async (msg) => {
          if (msg.type === 'GET_SETTINGS') {
            return {
              data: {
                activeEngine: 'gemini',
                geminiApiKey: 'test-key',
                geminiModel: 'gemini-1.5-flash',
                targetLanguage: 'Українська'
              }
            };
          }
          return {};
        },
        onMessage: { addListener: () => {} }
      }
    };

    const popup = await initPopup(doc, mockChrome);
    assert.ok(popup.selectSectionBtn, 'selectSectionBtn in popup');
    assert.equal(popup.selectSectionBtn.disabled, false);

    // Click select section button
    await popup.selectSectionBtn.dispatchEvent({ type: 'click' });

    const inspectorMsg = sentTabMessages.find(m => m.msg?.action === 'START_SECTION_INSPECTOR');
    assert.ok(inspectorMsg, 'Should send START_SECTION_INSPECTOR to active tab');
    assert.equal(inspectorMsg.tabId, 42);
    assert.equal(closed, true, 'Popup window closed after inspector trigger');
  } finally {
    globalThis.window = originalWindow;
  }
});
