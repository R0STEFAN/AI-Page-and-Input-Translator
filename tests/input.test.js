import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../background/storage.js';
import { buildInputTranslationPayload, translateInputGemini } from '../background/gemini.js';
import { handleMessage, handleContextMenuClick } from '../background/background.js';
import {
  getEditableTarget,
  initInputTracker,
  resetLastFocusedEditable,
  findActiveEditableElement,
  readEditableText,
  writeEditableText,
  translateActiveInput
} from '../content/input.js';
import { handleContentMessage } from '../content/content.js';
import { initPopup } from '../popup/popup.js';

class MockEditableElement {
  constructor(tagName = 'input', props = {}) {
    this.tagName = tagName.toUpperCase();
    this.type = props.type || 'text';
    this.value = props.value || '';
    this.innerText = props.innerText !== undefined ? props.innerText : undefined;
    this.textContent = props.textContent || '';
    this.isContentEditable = Boolean(props.isContentEditable);
    this.isConnected = props.isConnected !== undefined ? props.isConnected : true;
    this.parentElement = null;
    this.children = [];
    this.style = {};
    this.attributes = new Map(Object.entries(props.attributes || {}));
    this.dispatchedEvents = [];
    this.focused = false;
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
  }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }

  set className(val) {
    this.classList._classes.clear();
    (val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  focus() {
    this.focused = true;
  }

  dispatchEvent(ev) {
    this.dispatchedEvents.push(ev);
    return true;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.includes('[contenteditable="true"]') && curr.isContentEditable) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  getBoundingClientRect() {
    return { top: 20, left: 30, width: 300, height: 60 };
  }
}

class MockDoc {
  constructor() {
    this.documentElement = new MockEditableElement('html');
    this.body = new MockEditableElement('body');
    this.activeElement = this.body;
    this.listeners = new Map();
  }

  createElement(tag) {
    return new MockEditableElement(tag);
  }

  addEventListener(type, fn, capture) {
    const key = `${type}_${Boolean(capture)}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
  }

  trigger(type, eventObj, capture = true) {
    const key = `${type}_${Boolean(capture)}`;
    for (const fn of this.listeners.get(key) || []) {
      fn(eventObj);
    }
  }
}

test('DEFAULT_SETTINGS includes inputTargetLanguage set to English', () => {
  assert.equal(DEFAULT_SETTINGS.targetLanguage, 'Українська');
  assert.equal(DEFAULT_SETTINGS.inputTargetLanguage, 'English');
});

test('options.html includes inputTargetLanguage select field', () => {
  const html = fs.readFileSync(path.resolve('options/options.html'), 'utf8');
  assert.ok(html.includes('id="inputTargetLanguage"'), 'options.html must contain #inputTargetLanguage');
  assert.ok(html.includes('Мова перекладу інпутів'), 'options.html must contain input language label');
});

test('popup.html includes translateInputBtn button', () => {
  const html = fs.readFileSync(path.resolve('popup/popup.html'), 'utf8');
  assert.ok(html.includes('id="translateInputBtn"'), 'popup.html must contain #translateInputBtn');
});

test('buildInputTranslationPayload and translateInputGemini generate natural translation', async () => {
  const payload = buildInputTranslationPayload('Привіт, як справи?', 'English');
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.ok(payload.contents[0].parts[0].text.includes('natural, idiomatic, authentic English'));
  assert.ok(payload.contents[0].parts[0].text.includes('Привіт, як справи?'));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ translations: ["Hey, how's it going?"] }) }]
        }
      }]
    })
  });

  try {
    const translated = await translateInputGemini('Привіт, як справи?', 'English', 'gemini-2.5-flash', 'key-123');
    assert.equal(translated, "Hey, how's it going?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getEditableTarget identifies editable controls and ignores non-text inputs', () => {
  const textInput = new MockEditableElement('input', { type: 'text' });
  const searchInput = new MockEditableElement('input', { type: 'search' });
  const textarea = new MockEditableElement('textarea');
  const checkbox = new MockEditableElement('input', { type: 'checkbox' });
  const button = new MockEditableElement('input', { type: 'submit' });
  const plainDiv = new MockEditableElement('div');

  const ceRoot = new MockEditableElement('div', { isContentEditable: true });
  const ceInnerP = new MockEditableElement('p', { isContentEditable: true });
  ceRoot.appendChild(ceInnerP);

  assert.equal(getEditableTarget(textInput), textInput);
  assert.equal(getEditableTarget(searchInput), searchInput);
  assert.equal(getEditableTarget(textarea), textarea);
  assert.equal(getEditableTarget(checkbox), null);
  assert.equal(getEditableTarget(button), null);
  assert.equal(getEditableTarget(plainDiv), null);
  assert.equal(getEditableTarget(ceInnerP), ceRoot, 'Must resolve inner paragraph up to root contenteditable container');
});

test('initInputTracker remembers last focused editable even when activeElement resets to body', () => {
  resetLastFocusedEditable();
  const doc = new MockDoc();
  initInputTracker(doc);

  const textarea = new MockEditableElement('textarea', { value: 'Привіт світе' });
  doc.activeElement = textarea;
  doc.trigger('focusin', { target: textarea }, true);

  // Popup steals focus so activeElement falls back to body
  doc.activeElement = doc.body;
  const found = findActiveEditableElement(doc);
  assert.equal(found, textarea, 'Should recover last focused textarea after focus loss');
});

test('writeEditableText updates input/textarea and contenteditable and dispatches events', () => {
  const doc = new MockDoc();
  const EventStub = class {
    constructor(type, opts) {
      this.type = type;
      this.bubbles = Boolean(opts?.bubbles);
    }
  };
  const win = { Event: EventStub, InputEvent: EventStub };

  const textarea = new MockEditableElement('textarea', { value: 'Старий текст' });
  writeEditableText(textarea, 'Translated text', doc, win);
  assert.equal(textarea.focused, true);
  assert.equal(textarea.value, 'Translated text');
  assert.ok(textarea.dispatchedEvents.some(e => e.type === 'input'));
  assert.ok(textarea.dispatchedEvents.some(e => e.type === 'change'));

  const ceDiv = new MockEditableElement('div', { isContentEditable: true, innerText: 'Старий' });
  writeEditableText(ceDiv, 'Natural English comment', doc, win);
  assert.equal(ceDiv.innerText, 'Natural English comment');
  assert.ok(ceDiv.dispatchedEvents.some(e => e.type === 'input'));
});

test('translateActiveInput translates text via chrome messaging and cleans up thinking overlay', async () => {
  resetLastFocusedEditable();
  const doc = new MockDoc();
  const textarea = new MockEditableElement('textarea', { value: 'Дуже дякую за допомогу!' });
  doc.activeElement = textarea;

  let sentMsg = null;
  const mockChrome = {
    runtime: {
      sendMessage: async (msg) => {
        sentMsg = msg;
        const overlay = doc.body.children.find(c => c.id === 'ai-input-thinking-overlay');
        assert.ok(overlay, 'Thinking overlay must be visible while translating');
        assert.ok(overlay.classList.contains('ai-thinking'));
        return { ok: true, data: { translation: 'Thanks so much for the help!' } };
      }
    }
  };

  const alerts = [];
  const win = {
    alert: (m) => alerts.push(m),
    Event: class { constructor(t) { this.type = t; } },
    InputEvent: class { constructor(t) { this.type = t; } }
  };

  const ok = await translateActiveInput(doc, mockChrome, win);
  assert.equal(ok, true);
  assert.equal(sentMsg.type, 'TRANSLATE_INPUT');
  assert.equal(sentMsg.payload.text, 'Дуже дякую за допомогу!');
  assert.equal(textarea.value, 'Thanks so much for the help!');
  assert.equal(alerts.length, 0);
});

test('translateActiveInput alerts gracefully if no editable element or empty text', async () => {
  resetLastFocusedEditable();
  const doc = new MockDoc();
  const alerts = [];
  const win = { alert: (m) => alerts.push(m) };

  const res1 = await translateActiveInput(doc, { runtime: { sendMessage: async () => ({}) } }, win);
  assert.equal(res1, false);
  assert.ok(alerts[0].includes('поставте курсор'));

  const emptyInput = new MockEditableElement('input', { value: '   ' });
  doc.activeElement = emptyInput;
  const res2 = await translateActiveInput(doc, { runtime: { sendMessage: async () => ({}) } }, win);
  assert.equal(res2, false);
  assert.ok(alerts[1].includes('порожнє'));
});

test('handleMessage routes TRANSLATE_INPUT to Gemini using inputTargetLanguage', async () => {
  const originalFetch = globalThis.fetch;
  let capturedPrompt = '';

  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'gemini',
          geminiApiKey: 'test-key',
          geminiModel: 'gemini-2.5-flash',
          targetLanguage: 'Українська',
          inputTargetLanguage: 'English'
        })
      }
    }
  };

  globalThis.fetch = async (url, opts) => {
    capturedPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: ['Sounds good to me!'] }) }] } }]
      })
    };
  };

  try {
    const response = await new Promise((resolve) => {
      handleMessage(
        { type: 'TRANSLATE_INPUT', payload: { text: 'Мені це підходить!' } },
        {},
        resolve
      );
    });

    assert.equal(response.ok, true);
    assert.equal(response.data.translation, 'Sounds good to me!');
    assert.ok(capturedPrompt.includes('English'), 'Must use inputTargetLanguage instead of page targetLanguage');
  } finally {
    delete globalThis.chrome;
    globalThis.fetch = originalFetch;
  }
});

test('handleMessage rejects TRANSLATE_INPUT when OPUS-MT en-uk is active with non-Ukrainian input target', async () => {
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          activeEngine: 'local',
          localSelectedModel: 'Xenova/opus-mt-en-uk',
          localModelLoaded: true,
          inputTargetLanguage: 'English'
        })
      }
    }
  };

  try {
    const response = await new Promise((resolve) => {
      handleMessage(
        { type: 'TRANSLATE_INPUT', payload: { text: 'Привіт!' } },
        {},
        resolve
      );
    });

    assert.equal(response.ok, false);
    assert.ok(response.error.includes('OPUS-MT'));
  } finally {
    delete globalThis.chrome;
  }
});

test('handleContextMenuClick triggers TRANSLATE_ACTIVE_INPUT when ai-translate-input clicked', async () => {
  let sentAction = null;
  globalThis.chrome = {
    tabs: {
      sendMessage: async (tabId, msg) => {
        sentAction = msg.action;
      }
    }
  };

  try {
    await handleContextMenuClick({ menuItemId: 'ai-translate-input' }, { id: 77 });
    assert.equal(sentAction, 'TRANSLATE_ACTIVE_INPUT');
  } finally {
    delete globalThis.chrome;
  }
});

test('handleContentMessage handles TRANSLATE_ACTIVE_INPUT action', () => {
  const doc = new MockDoc();
  let response = null;
  const handled = handleContentMessage(
    { action: 'TRANSLATE_ACTIVE_INPUT' },
    {},
    (res) => { response = res; },
    doc,
    null,
    { alert: () => {} }
  );

  assert.equal(handled, false);
  assert.deepEqual(response, { ok: true });
});

test('popup translateInputBtn shows inputTargetLanguage, triggers TRANSLATE_ACTIVE_INPUT and closes popup', async () => {
  const doc = new MockDoc();
  const elements = new Map();
  const makeEl = (id, tag = 'button') => {
    const el = new MockEditableElement(tag);
    el.id = id;
    el.disabled = false;
    el.listeners = new Map();
    el.addEventListener = (t, fn) => {
      if (!el.listeners.has(t)) el.listeners.set(t, []);
      el.listeners.get(t).push(fn);
    };
    el.dispatchEvent = async (ev) => {
      for (const fn of el.listeners.get(ev.type) || []) {
        await fn(ev);
      }
    };
    elements.set(id, el);
    return el;
  };

  makeEl('engineBadge', 'span');
  makeEl('langBadge', 'span');
  makeEl('alertBox', 'div');
  makeEl('toggleTranslateBtn', 'button');
  makeEl('selectSectionBtn', 'button');
  makeEl('translateInputBtn', 'button');

  doc.getElementById = (id) => elements.get(id) || null;

  const sentTabMessages = [];
  let closed = false;
  const originalWindow = globalThis.window;
  globalThis.window = { close: () => { closed = true; } };

  try {
    const mockChrome = {
      tabs: {
        query: async () => [{ id: 88 }],
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
                geminiModel: 'gemini-2.5-flash',
                targetLanguage: 'Українська',
                inputTargetLanguage: 'English'
              }
            };
          }
          return {};
        },
        onMessage: { addListener: () => {} }
      }
    };

    const popup = await initPopup(doc, mockChrome);
    assert.ok(popup.translateInputBtn.textContent.includes('English'));

    await popup.translateInputBtn.dispatchEvent({ type: 'click' });
    const msg = sentTabMessages.find(m => m.msg?.action === 'TRANSLATE_ACTIVE_INPUT');
    assert.ok(msg, 'Should dispatch TRANSLATE_ACTIVE_INPUT to active tab');
    assert.equal(closed, true, 'Popup should close');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('findActiveEditableElement and initInputTracker pierce Shadow DOM hosts via shadowRoot and composedPath', () => {
  resetLastFocusedEditable();
  const doc = new MockDoc();
  const innerEditor = new MockEditableElement('div', {
    isContentEditable: true,
    innerText: 'Привіт з Reddit'
  });
  const shadowHost = new MockEditableElement('shreddit-composer');
  shadowHost.shadowRoot = { activeElement: innerEditor };

  doc.activeElement = shadowHost;
  assert.equal(findActiveEditableElement(doc), innerEditor);

  // Also test composedPath() tracking when activeElement later blurs to null
  resetLastFocusedEditable();
  doc.activeElement = null;
  initInputTracker(doc);
  doc.trigger('input', {
    target: shadowHost,
    composedPath: () => [innerEditor, shadowHost, doc]
  });
  assert.equal(findActiveEditableElement(doc), innerEditor);
});

test('writeEditableText auto-selects unselected text in textarea and contenteditable (including paste fallback)', () => {
  // 1) Textarea auto-selection via select() / setSelectionRange() + execCommand('selectAll', 'insertText')
  const doc1 = new MockDoc();
  const execCalls1 = [];
  let selectedRange = null;
  doc1.execCommand = (cmd, _ui, val) => {
    execCalls1.push({ cmd, val });
    if (cmd === 'insertText' && selectedRange) {
      textarea.value = val;
      return true;
    }
    return cmd === 'selectAll';
  };

  const textarea = new MockEditableElement('textarea', { value: 'Невиділений текст' });
  textarea.setSelectionRange = (start, end) => {
    selectedRange = [start, end];
  };

  writeEditableText(textarea, 'Unselected text', doc1, {});
  assert.deepEqual(selectedRange, [0, 'Невиділений текст'.length]);
  assert.equal(execCalls1[0].cmd, 'selectAll');
  assert.equal(execCalls1[1].cmd, 'insertText');
  assert.equal(textarea.value, 'Unselected text');

  // 2) Contenteditable auto-selection + ClipboardEvent('paste') fallback when execCommand fails
  const doc2 = new MockDoc();
  const execCalls2 = [];
  doc2.execCommand = (cmd, _ui, val) => {
    execCalls2.push({ cmd, val });
    return false;
  };
  doc2.createRange = () => ({ selectNodeContents: () => {} });

  const editor = new MockEditableElement('div', {
    isContentEditable: true,
    innerText: 'Початковий текст без виділення'
  });

  class FakeDataTransfer {
    constructor() { this.data = new Map(); }
    setData(type, val) { this.data.set(type, val); }
    getData(type) { return this.data.get(type) || ''; }
  }
  class FakeClipboardEvent {
    constructor(type, init) {
      this.type = type;
      this.clipboardData = init.clipboardData;
    }
  }
  const origDispatch = editor.dispatchEvent.bind(editor);
  editor.dispatchEvent = (ev) => {
    origDispatch(ev);
    if (ev.type === 'paste') {
      editor.innerText = ev.clipboardData.getData('text/plain');
    }
  };

  const win2 = {
    getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }),
    ClipboardEvent: FakeClipboardEvent,
    DataTransfer: FakeDataTransfer
  };

  writeEditableText(editor, 'Translated pasted text', doc2, win2);
  assert.ok(execCalls2.some(c => c.cmd === 'selectAll'));
  assert.equal(editor.innerText, 'Translated pasted text');
  assert.ok(editor.dispatchedEvents.some(e => e.type === 'paste'));
});

test('findActiveEditableElement falls back to visible non-empty editable when activeElement is null', () => {
  resetLastFocusedEditable();
  const doc = new MockDoc();
  doc.activeElement = null;

  const emptySearch = new MockEditableElement('input', { value: '' });
  emptySearch.getBoundingClientRect = () => ({ width: 200, height: 32 });

  const hiddenTextarea = new MockEditableElement('textarea', { value: 'Hidden text' });
  hiddenTextarea.getBoundingClientRect = () => ({ width: 0, height: 0 });

  const visibleEditor = new MockEditableElement('div', {
    isContentEditable: true,
    innerText: 'Мій коментар для перекладу'
  });
  visibleEditor.getBoundingClientRect = () => ({ width: 400, height: 120 });

  const shadowHost = new MockEditableElement('custom-composer');
  shadowHost.shadowRoot = {
    querySelectorAll: (sel) => (sel.includes('textarea') ? [visibleEditor] : [])
  };

  doc.querySelectorAll = (sel) => {
    if (sel === '*') return [shadowHost];
    return [emptySearch, hiddenTextarea];
  };

  assert.equal(findActiveEditableElement(doc), visibleEditor);
});

test('writeEditableText clears contenteditable before insert and never duplicates text on paste/beforeinput', () => {
  const doc = new MockDoc();
  const editor = new MockEditableElement('div', {
    isContentEditable: true,
    innerText: 'Початковий текст'
  });

  const execCalls = [];
  doc.execCommand = (cmd, _ui, val) => {
    execCalls.push({ cmd, val });
    // Simulate a quirky rich-text editor where delete fails, insertText appends once instead of replacing
    if (cmd === 'insertText') {
      editor.innerText += val;
      return true;
    }
    return cmd === 'selectAll';
  };
  doc.createRange = () => ({ selectNodeContents: () => {} });

  class FakeDataTransfer {
    constructor() { this.data = new Map(); }
    setData(type, val) { this.data.set(type, val); }
    getData(type) { return this.data.get(type) || ''; }
  }
  class FakeClipboardEvent {
    constructor(type, init) {
      this.type = type;
      this.clipboardData = init.clipboardData;
    }
  }
  const origDispatch = editor.dispatchEvent.bind(editor);
  editor.dispatchEvent = (ev) => {
    origDispatch(ev);
    if (ev.type === 'paste') {
      editor.innerText += ev.clipboardData.getData('text/plain');
    }
  };

  const win = {
    getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }),
    ClipboardEvent: FakeClipboardEvent,
    DataTransfer: FakeDataTransfer
  };

  writeEditableText(editor, 'Translated text', doc, win);

  assert.ok(execCalls.some(c => c.cmd === 'delete'), 'Should attempt execCommand("delete") before insert');
  assert.equal(editor.dispatchedEvents.filter(e => e.type === 'paste').length, 0, 'Must NOT paste again after insertText already inserted translated text');
  assert.equal(editor.dispatchedEvents.filter(e => e.type === 'beforeinput').length, 0, 'Must NOT fire extra beforeinput that would duplicate text');
  const occurrences = editor.innerText.split('Translated text').length - 1;
  assert.equal(occurrences, 1, 'Translated text must appear at most once');
});
