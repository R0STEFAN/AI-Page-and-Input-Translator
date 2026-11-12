import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateDensityScore, findMainContent } from '../content/detector.js';
import { collectTextElements } from '../content/walker.js';
import { replaceTextBatch, restoreOriginalText } from '../content/replacer.js';

// Helper to create mock DOM elements for testing
function createMockElement(tag, {
  text = '',
  html = null,
  parent = null,
  classes = [],
  dataset = {},
  role = null,
  tagName = tag.toUpperCase()
} = {}) {
  const classList = new Set(classes);
  const children = [];
  let _innerText = text;
  let _innerHTML = html !== null ? html : text;

  const el = {
    tagName,
    role,
    parentElement: parent,
    children,
    dataset: { ...dataset },
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      contains: (c) => classList.has(c)
    },
    closest(selector) {
      const selectors = selector.split(',').map(s => s.trim());
      let curr = this;
      while (curr) {
        for (const s of selectors) {
          if (s.startsWith('.')) {
            const cls = s.slice(1);
            if (curr.classList && curr.classList.contains(cls)) return curr;
          } else if (curr.tagName && curr.tagName.toLowerCase() === s.toLowerCase()) {
            return curr;
          }
        }
        curr = curr.parentElement;
      }
      return null;
    },
    getElementsByTagName(name) {
      const results = [];
      function walk(node) {
        for (const child of node.children) {
          if (name === '*' || child.tagName.toLowerCase() === name.toLowerCase()) {
            results.push(child);
          }
          walk(child);
        }
      }
      walk(this);
      return results;
    },
    querySelector(selector) {
      const list = this.querySelectorAll(selector);
      return list.length > 0 ? list[0] : null;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(s => s.trim());
      const results = [];
      function walk(node) {
        for (const child of node.children) {
          const match = selectors.some(s => {
            if (s.startsWith('.')) {
              return child.classList && child.classList.contains(s.slice(1));
            }
            if (s.startsWith('[') && s.endsWith(']')) {
              const attr = s.slice(1, -1);
              if (attr.includes('=')) {
                const [k, v] = attr.split('=').map(x => x.replace(/["']/g, ''));
                return child[k] === v || (child.dataset && child.dataset[k] === v);
              }
              if (attr.startsWith('data-')) {
                const camel = attr.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
                return child.dataset && child.dataset[camel] !== undefined;
              }
              return false;
            }
            return child.tagName.toLowerCase() === s.toLowerCase();
          });
          if (match) results.push(child);
          walk(child);
        }
      }
      walk(this);
      return results;
    },
    appendChild(child) {
      child.parentElement = this;
      children.push(child);
      return child;
    }
  };

  Object.defineProperty(el, 'innerHTML', {
    get: () => _innerHTML,
    set: (val) => {
      _innerHTML = val;
      _innerText = val ? val.replace(/<[^>]*>/g, '') : '';
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(el, 'innerText', {
    get: () => _innerText,
    set: (val) => {
      _innerText = val;
      _innerHTML = val;
    },
    enumerable: true,
    configurable: true
  });

  return el;
}

function createMockDoc(body) {
  return {
    body,
    querySelector(selector) {
      const list = this.querySelectorAll(selector);
      return list.length > 0 ? list[0] : null;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(s => s.trim());
      const results = [];
      function walk(node) {
        if (!node) return;
        const match = selectors.some(s => {
          if (s.startsWith('.')) {
            return node.classList && node.classList.contains(s.slice(1));
          }
          if (s.startsWith('[') && s.endsWith(']')) {
            const attr = s.slice(1, -1);
            if (attr.includes('=')) {
              const [k, v] = attr.split('=').map(x => x.replace(/["']/g, ''));
              return node[k] === v || (node.dataset && node.dataset[k] === v);
            }
            if (attr.startsWith('data-')) {
              const camel = attr.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
              return node.dataset && node.dataset[camel] !== undefined;
            }
            return false;
          }
          return node.tagName.toLowerCase() === s.toLowerCase();
        });
        if (match && node !== body) {
          results.push(node);
        }
        if (node.children) {
          for (const c of node.children) {
            walk(c);
          }
        }
      }
      walk(body);
      return results;
    }
  };
}

// ==========================================
// Density Score Tests
// ==========================================

test('calculateDensityScore favors text-heavy containers with paragraphs', () => {
  const highDensity = { textLength: 1200, tagCount: 15, paragraphCount: 6 };
  const lowDensity = { textLength: 150, tagCount: 30, paragraphCount: 1 };

  const scoreHigh = calculateDensityScore(highDensity.textLength, highDensity.tagCount, highDensity.paragraphCount);
  const scoreLow = calculateDensityScore(lowDensity.textLength, lowDensity.tagCount, lowDensity.paragraphCount);

  assert.ok(scoreHigh > scoreLow, 'High density content must score higher than low density navigation/footer');
});

test('calculateDensityScore returns 0 if textLength < 100 or paragraphCount < 1', () => {
  assert.equal(calculateDensityScore(99, 5, 3), 0, 'Text length < 100 should score 0');
  assert.equal(calculateDensityScore(500, 5, 0), 0, 'Paragraph count < 1 should score 0');
  assert.equal(calculateDensityScore(50, 2, 0), 0, 'Both low should score 0');
});

test('calculateDensityScore handles tagCount <= 0 safely', () => {
  const score = calculateDensityScore(200, 0, 4);
  // (200 / 1) * sqrt(4) = 400
  assert.equal(score, 400);
});

// ==========================================
// Main Content Detector Tests
// ==========================================

test('findMainContent returns null if doc is null or undefined', () => {
  assert.equal(findMainContent(null), null);
  assert.equal(findMainContent(undefined), null);
});

test('findMainContent detects semantic <main> or article if innerText > 300 chars', () => {
  const body = createMockElement('body');
  const main = createMockElement('main', { text: 'A'.repeat(350), parent: body });
  body.appendChild(main);
  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, main, 'Should return semantic main element');
});

test('findMainContent detects element with role="main" if innerText > 300 chars', () => {
  const body = createMockElement('body');
  const div = createMockElement('div', { text: 'B'.repeat(320), parent: body, role: 'main' });
  body.appendChild(div);
  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, div, 'Should return role="main" element');
});

test('findMainContent detects feed items parent if >= 3 items present', () => {
  const body = createMockElement('body');
  const feedContainer = createMockElement('div', { classes: ['feed'], parent: body });
  body.appendChild(feedContainer);

  const item1 = createMockElement('div', { classes: ['feed-item'], text: 'Item 1', parent: feedContainer });
  const item2 = createMockElement('div', { classes: ['feed-item'], text: 'Item 2', parent: feedContainer });
  const item3 = createMockElement('div', { classes: ['feed-item'], text: 'Item 3', parent: feedContainer });
  feedContainer.appendChild(item1);
  feedContainer.appendChild(item2);
  feedContainer.appendChild(item3);

  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, feedContainer, 'Should return common parent of feed items');
});

test('findMainContent properly detects feed container when multiple <article> elements are present', () => {
  const body = createMockElement('body');
  const feedContainer = createMockElement('div', { classes: ['feed-container'], parent: body });
  body.appendChild(feedContainer);

  // 3 article elements each with > 300 characters
  const art1 = createMockElement('article', { text: 'Article one content. '.repeat(20), parent: feedContainer });
  const art2 = createMockElement('article', { text: 'Article two content. '.repeat(20), parent: feedContainer });
  const art3 = createMockElement('article', { text: 'Article three content. '.repeat(20), parent: feedContainer });
  feedContainer.appendChild(art1);
  feedContainer.appendChild(art2);
  feedContainer.appendChild(art3);

  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, feedContainer, 'Must detect common feed container parent rather than first article');
});

test('findMainContent traverses up to common ancestor when feed items are nested in wrappers', () => {
  const body = createMockElement('body');
  const feedGrid = createMockElement('div', { classes: ['feed-grid'], parent: body });
  body.appendChild(feedGrid);

  const wrap1 = createMockElement('div', { classes: ['card-wrapper'], parent: feedGrid });
  const item1 = createMockElement('div', { classes: ['card'], text: 'Card 1 content', parent: wrap1 });
  wrap1.appendChild(item1);

  const wrap2 = createMockElement('div', { classes: ['card-wrapper'], parent: feedGrid });
  const item2 = createMockElement('div', { classes: ['card'], text: 'Card 2 content', parent: wrap2 });
  wrap2.appendChild(item2);

  const wrap3 = createMockElement('div', { classes: ['card-wrapper'], parent: feedGrid });
  const item3 = createMockElement('div', { classes: ['card'], text: 'Card 3 content', parent: wrap3 });
  wrap3.appendChild(item3);

  feedGrid.appendChild(wrap1);
  feedGrid.appendChild(wrap2);
  feedGrid.appendChild(wrap3);

  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, feedGrid, 'Must traverse up to feedGrid ancestor containing all items');
});

test('findMainContent falls back to density scoring when no semantic or feed items qualify', () => {
  const body = createMockElement('body');

  // Sidebar container (inside .sidebar) -> should be ignored
  const sidebar = createMockElement('div', { classes: ['sidebar'], parent: body });
  const sidebarInner = createMockElement('div', { text: 'C'.repeat(500), parent: sidebar });
  sidebar.appendChild(sidebarInner);
  body.appendChild(sidebar);

  // Blacklisted header tag -> should be ignored
  const header = createMockElement('header', { text: 'D'.repeat(600), parent: body });
  body.appendChild(header);

  // High density article body candidate
  const contentSection = createMockElement('section', { text: 'E'.repeat(800), parent: body });
  for (let i = 0; i < 5; i++) {
    contentSection.appendChild(createMockElement('p', { text: 'Paragraph text ' + i, parent: contentSection }));
  }
  body.appendChild(contentSection);

  // Low density footer container
  const footerCandidate = createMockElement('div', { text: 'F'.repeat(120), parent: body });
  footerCandidate.appendChild(createMockElement('p', { text: 'Footer', parent: footerCandidate }));
  body.appendChild(footerCandidate);

  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, contentSection, 'Should return highest density candidate section');
});

test('findMainContent returns body when no candidate scores above 0', () => {
  const body = createMockElement('body');
  const tinyDiv = createMockElement('div', { text: 'short', parent: body });
  body.appendChild(tinyDiv);
  const doc = createMockDoc(body);

  const found = findMainContent(doc);
  assert.equal(found, body, 'Should default to doc.body');
});

// ==========================================
// DOM Walker Tests
// ==========================================

test('collectTextElements returns empty array for null/invalid root', () => {
  assert.deepEqual(collectTextElements(null), []);
  assert.deepEqual(collectTextElements({}), []);
});

test('collectTextElements extracts text targets and stores dataset.aiOriginalText and aiOriginalHtml', () => {
  const root = createMockElement('div');
  const p1 = createMockElement('p', {
    text: 'This is the first paragraph with a link.',
    html: 'This is the first paragraph with a <a href="https://example.com">link</a>.',
    parent: root
  });
  const h2 = createMockElement('h2', { text: 'Header Title', parent: root });
  const li = createMockElement('li', { text: 'List item entry', parent: root });
  root.appendChild(p1);
  root.appendChild(h2);
  root.appendChild(li);

  const elements = collectTextElements(root);
  assert.equal(elements.length, 3);
  assert.equal(p1.dataset.aiOriginalText, 'This is the first paragraph with a link.');
  assert.equal(p1.dataset.aiOriginalHtml, 'This is the first paragraph with a <a href="https://example.com">link</a>.');
  assert.equal(h2.dataset.aiOriginalText, 'Header Title');
  assert.equal(li.dataset.aiOriginalText, 'List item entry');
});

test('collectTextElements skips code blocks and short strings', () => {
  const root = createMockElement('div');
  const pre = createMockElement('pre', { parent: root });
  const codeP = createMockElement('p', { text: 'const a = 123; let b = 456;', parent: pre });
  pre.appendChild(codeP);
  root.appendChild(pre);

  const shortP = createMockElement('p', { text: 'a', parent: root });
  root.appendChild(shortP);

  const validP = createMockElement('p', { text: 'Valid sentence to translate.', parent: root });
  root.appendChild(validP);

  const elements = collectTextElements(root);
  assert.equal(elements.length, 1);
  assert.equal(elements[0], validP);
});

test('collectTextElements ignores parent blocks containing child target blocks', () => {
  const root = createMockElement('div');

  // blockquote containing a p
  const blockquote = createMockElement('blockquote', { text: 'Outer quote', parent: root });
  const innerP = createMockElement('p', { text: 'Inner paragraph inside quote', parent: blockquote });
  blockquote.appendChild(innerP);
  root.appendChild(blockquote);

  // li containing a p
  const li = createMockElement('li', { text: 'List item', parent: root });
  const listP = createMockElement('p', { text: 'Paragraph inside list item', parent: li });
  li.appendChild(listP);
  root.appendChild(li);

  // standalone h2
  const h2 = createMockElement('h2', { text: 'Standalone title', parent: root });
  root.appendChild(h2);

  const elements = collectTextElements(root);

  assert.ok(!elements.includes(blockquote), 'Must skip outer blockquote containing child p');
  assert.ok(!elements.includes(li), 'Must skip outer li containing child p');
  assert.ok(elements.includes(innerP), 'Must include inner p of blockquote');
  assert.ok(elements.includes(listP), 'Must include inner p of li');
  assert.ok(elements.includes(h2), 'Must include standalone h2');
  assert.equal(elements.length, 3);
});

test('collectTextElements ignores already translated blocks (.ai-translated-block or data-ai-original-html)', () => {
  const root = createMockElement('div');

  // Element with ai-translated-block class
  const translatedP = createMockElement('p', {
    text: 'Вже перекладений текст',
    classes: ['ai-translated-block'],
    parent: root
  });
  root.appendChild(translatedP);

  // Element with dataset.aiOriginalHtml
  const cachedP = createMockElement('p', {
    text: 'Another translated block',
    dataset: { aiOriginalHtml: '<p>Original text</p>' },
    parent: root
  });
  root.appendChild(cachedP);

  // Element inside an already translated container
  const translatedContainer = createMockElement('div', {
    classes: ['ai-translated-block'],
    parent: root
  });
  const childOfTranslated = createMockElement('p', {
    text: 'Child of translated container',
    parent: translatedContainer
  });
  translatedContainer.appendChild(childOfTranslated);
  root.appendChild(translatedContainer);

  // Fresh untranslated element
  const freshP = createMockElement('p', {
    text: 'Fresh text waiting to be translated',
    parent: root
  });
  root.appendChild(freshP);

  const elements = collectTextElements(root);

  assert.equal(elements.length, 1, 'Only fresh untranslated element should be collected');
  assert.equal(elements[0], freshP);
});

// ==========================================
// In-Place Replacer & Restoration Tests
// ==========================================

test('replaceTextBatch replaces innerText and adds .ai-translated-block class', () => {
  const p1 = createMockElement('p', { text: 'Original 1' });
  const p2 = createMockElement('p', { text: 'Original 2' });
  const p3 = createMockElement('p', { text: 'Original 3' });

  const translations = ['Переклад 1', 'Переклад 2', ''];

  replaceTextBatch([p1, p2, p3], translations);

  assert.equal(p1.innerText, 'Переклад 1');
  assert.ok(p1.classList.contains('ai-translated-block'));

  assert.equal(p2.innerText, 'Переклад 2');
  assert.ok(p2.classList.contains('ai-translated-block'));

  assert.equal(p3.innerText, 'Original 3', 'Empty translation must not overwrite text');
  assert.ok(!p3.classList.contains('ai-translated-block'));
});

test('restoreOriginalText reverts translated elements and cleans up classes/datasets', () => {
  const body = createMockElement('body', { dataset: { aiPageTranslated: 'true' } });
  const p1 = createMockElement('p', {
    text: 'Перекладений текст 1',
    classes: ['ai-translated-block'],
    dataset: { aiOriginalText: 'Original English 1' },
    parent: body
  });
  const p2 = createMockElement('p', {
    text: 'Перекладений текст 2',
    classes: ['ai-translated-block'],
    dataset: { aiOriginalText: 'Original English 2' },
    parent: body
  });
  body.appendChild(p1);
  body.appendChild(p2);

  const doc = createMockDoc(body);

  restoreOriginalText(doc);

  assert.equal(p1.innerText, 'Original English 1');
  assert.ok(!p1.classList.contains('ai-translated-block'));
  assert.equal(p1.dataset.aiOriginalText, undefined);

  assert.equal(p2.innerText, 'Original English 2');
  assert.ok(!p2.classList.contains('ai-translated-block'));
  assert.equal(p2.dataset.aiOriginalText, undefined);

  assert.equal(body.dataset.aiPageTranslated, undefined);
});

test('restoreOriginalText recovers original innerHTML with <a> links intact', () => {
  const body = createMockElement('body', { dataset: { aiPageTranslated: 'true' } });
  const originalHtml = 'Click <a href="https://example.com">here</a> for <strong>more</strong> info.';
  const p = createMockElement('p', {
    text: 'Translated text without link markup',
    classes: ['ai-translated-block'],
    dataset: {
      aiOriginalText: 'Click here for more info.',
      aiOriginalHtml: originalHtml
    },
    parent: body
  });
  body.appendChild(p);

  const doc = createMockDoc(body);
  restoreOriginalText(doc);

  assert.equal(p.innerHTML, originalHtml, 'Must restore full HTML including <a> tags');
  assert.equal(p.dataset.aiOriginalHtml, undefined, 'Must clean up aiOriginalHtml');
  assert.equal(p.dataset.aiOriginalText, undefined, 'Must clean up aiOriginalText');
  assert.ok(!p.classList.contains('ai-translated-block'), 'Must remove translated class');
  assert.equal(body.dataset.aiPageTranslated, undefined, 'Must clean up page translated flag');
});

// ==========================================
// CSS Stylesheet Verification Tests
// ==========================================

test('content.css exists and contains required transition and animation classes', () => {
  const cssPath = path.resolve('content/content.css');
  assert.ok(fs.existsSync(cssPath), 'content/content.css must exist');

  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.ai-translated-block'), 'Must contain .ai-translated-block');
  assert.ok(css.includes('.ai-translated-selection'), 'Must contain .ai-translated-selection');
  assert.ok(css.includes('.ai-translating-pulse'), 'Must contain .ai-translating-pulse');
  assert.ok(css.includes('@keyframes ai-pulse'), 'Must contain @keyframes ai-pulse');
});
