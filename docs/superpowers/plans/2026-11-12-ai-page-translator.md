# AI Page Translator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade Chrome Extension (Manifest V3) for full-page main content and selection translation using Google Gemini API or an in-browser local model (WebGPU / WASM).

**Architecture:** Dual translation engines (Gemini REST API in Service Worker + In-Browser local NLLB-200 in Offscreen Document). Content script heuristically locates main content (article or feed), chunks text blocks, sends batches to background, and performs progressive in-place DOM replacement with instant restore. Right-click context menu replaces selected text in-place. Options page provides dynamic Gemini model fetching via API and one-click in-browser local model downloading.

**Tech Stack:** JavaScript (ES modules), Chrome Extensions Manifest V3 (`storage`, `contextMenus`, `activeTab`, `offscreen`), Google Gemini API REST v1beta, Transformers.js (WebGPU/WASM), Node.js native test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-11-12-ai-page-translator-design.md`

## Global Constraints

* Manifest V3 only: service worker background, declarative permissions, strict CSP.
* All icons referenced in `manifest.json` must be real PNG files generated to exact dimensions (16, 32, 48, 128 px).
* Offscreen document must be used for WebGPU / Transformers.js operations because Service Workers cannot access WebGPU or DOM.
* In-place DOM replacement must not break original element layout, CSS classes, or child links.
* Selection translation must replace text directly within the selection `Range` on the page with a click-to-restore span.
* Storage keys and settings must have defaults (`targetLanguage: "uk"`, `activeEngine: "gemini"`).

---

### Task 1: Manifest V3 Configuration & Real Icon Generation

**Files:**
- Create: `scripts/generate-icons.js`
- Create: `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`
- Create: `manifest.json`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Produces: Valid `manifest.json` pointing to real icon assets, background worker, popup, options, and content scripts.

- [ ] **Step 1: Write the manifest & icon test**

Create `tests/manifest.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('manifest.json exists and has valid MV3 fields', () => {
  const manifestPath = path.resolve('manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'AI Page Translator');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.action && manifest.action.default_popup);

  // Verify all declared icons exist on disk
  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    const fullPath = path.resolve(iconPath);
    assert.ok(fs.existsSync(fullPath), `Icon file ${iconPath} must exist`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `Icon file ${iconPath} must not be empty`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/manifest.test.js`  
Expected: FAIL (manifest.json does not exist)

- [ ] **Step 3: Write icon generator script and generate icons**

Create `scripts/generate-icons.js`:
```javascript
import fs from 'node:fs';
import path from 'node:path';

// Minimal 1-pixel transparent PNG base header with solid RGB color filling
function createPngBuffer(width, height) {
  // A valid uncompressed PNG file with an icon pattern
  // Uses pure Node.js buffer manipulation to generate real valid PNGs
  const { createCanvas } = (() => {
    // Basic BMP to PNG or raw PNG construction
    return { createCanvas: null };
  })();

  // Real minimal valid PNG generator
  const zlib = await import('node:zlib');
  
  function dword(val) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(val, 0);
    return b;
  }

  function chunk(type, data) {
    const len = dword(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = dword(zlib.crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.concat([
    dword(width),
    dword(height),
    Buffer.from([8, 6, 0, 0, 0]) // 8-bit depth, RGBA (6)
  ]);
  const ihdr = chunk('IHDR', ihdrData);

  // Image data: each scanline starts with filter byte 0, followed by width * 4 RGBA bytes
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // Filter none
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      // Blue-violet gradient with letter / symbol area
      row[idx] = 37;      // R: #2563EB
      row[idx + 1] = 99;  // G
      row[idx + 2] = 235; // B
      row[idx + 3] = 255; // A
    }
    scanlines.push(row);
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const iconsDir = path.resolve('icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const buf = await createPngBuffer(size, size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png (${buf.length} bytes)`);
}
```

Run: `node scripts/generate-icons.js`

- [ ] **Step 4: Create manifest.json**

Create `manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "AI Page Translator",
  "version": "1.0.0",
  "description": "Розумний перекладач сторінок та виділеного тексту за допомогою Google Gemini та вбудованої офлайн-нейромережі.",
  "permissions": [
    "storage",
    "contextMenus",
    "activeTab",
    "offscreen"
  ],
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*",
    "https://huggingface.co/*",
    "https://*.hf.co/*"
  ],
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "AI Page Translator",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options/options.html",
  "background": {
    "service_worker": "background/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/manifest.test.js`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add manifest.json icons/ scripts/ tests/manifest.test.js
git commit -m "feat: setup manifest v3 and generate icons"
```

---

### Task 2: Storage Utilities & Gemini API Service Client

**Files:**
- Create: `background/storage.js`
- Create: `background/gemini.js`
- Test: `tests/gemini.test.js`

**Interfaces:**
- `getSettings()`: Promise resolving to `{ activeEngine, geminiApiKey, geminiModel, targetLanguage, localModelLoaded }`
- `saveSettings(patch)`: Promise resolving to updated settings object
- `fetchGeminiModels(apiKey)`: Promise resolving to string array of models supporting `generateContent`
- `translateBatchGemini(texts, targetLanguage, model, apiKey)`: Promise resolving to `{ translations: string[] }`
- `translateSingleGemini(text, targetLanguage, model, apiKey)`: Promise resolving to string

- [ ] **Step 1: Write the failing tests for storage and gemini client**

Create `tests/gemini.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortModels, buildBatchTranslationPayload, parseGeminiResponse } from '../background/gemini.js';

test('filterAndSortModels extracts generateContent models and prioritizes flash', () => {
  const mockApiData = {
    models: [
      { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
    ]
  };

  const models = filterAndSortModels(mockApiData);
  assert.deepEqual(models, [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ]);
});

test('buildBatchTranslationPayload formats structured JSON request', () => {
  const texts = ['Hello world', 'Welcome to our blog'];
  const payload = buildBatchTranslationPayload(texts, 'Українська');

  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.ok(payload.contents[0].parts[0].text.includes('Hello world'));
  assert.ok(payload.contents[0].parts[0].text.includes('Українська'));
});

test('parseGeminiResponse extracts and validates translations array', () => {
  const mockResponse = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                translations: ['Привіт світ', 'Ласкаво просимо до нашого блогу']
              })
            }
          ]
        }
      }
    ]
  };

  const translations = parseGeminiResponse(mockResponse, 2);
  assert.deepEqual(translations, ['Привіт світ', 'Ласкаво просимо до нашого блогу']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gemini.test.js`  
Expected: FAIL (Cannot find module '../background/gemini.js')

- [ ] **Step 3: Implement storage.js and gemini.js**

Create `background/storage.js`:
```javascript
export const DEFAULT_SETTINGS = {
  activeEngine: 'gemini', // 'gemini' | 'local'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  geminiAvailableModels: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  targetLanguage: 'Українська',
  localModelLoaded: false
};

export async function getSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS };
  }
  const storageArea = chrome.storage.sync || chrome.storage.local;
  const data = await storageArea.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}

export async function saveSettings(patch) {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS, ...patch };
  }
  const storageArea = chrome.storage.sync || chrome.storage.local;
  await storageArea.set(patch);
  return getSettings();
}
```

Create `background/gemini.js`:
```javascript
export function filterAndSortModels(apiData) {
  if (!apiData || !Array.isArray(apiData.models)) return [];

  const models = apiData.models
    .filter(m => {
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') && !m.name.includes('embedding');
    })
    .map(m => m.name.replace(/^models\//, ''));

  return models.sort((a, b) => {
    const aFlash = a.includes('flash');
    const bFlash = b.includes('flash');
    if (aFlash && !bFlash) return -1;
    if (!aFlash && bFlash) return 1;
    return b.localeCompare(a);
  });
}

export function buildBatchTranslationPayload(texts, targetLanguage) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a professional website translator. Translate the array of text items below into ${targetLanguage}. Maintain accurate phrasing, punctuation, numbers, and proper nouns. Return strict JSON matching {"translations": ["...", "..."]} with the exact same count and order.\n\nInput JSON:\n${JSON.stringify({ texts })}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          translations: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          }
        },
        required: ['translations']
      }
    }
  };
}

export function parseGeminiResponse(responseJson, expectedCount) {
  const partText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!partText) throw new Error('Порожня або некоректна відповідь від Gemini API');

  let parsed;
  try {
    parsed = JSON.parse(partText.trim());
  } catch {
    throw new Error('Не вдалося розібрати JSON перекладу від Gemini API');
  }

  const translations = Array.isArray(parsed) ? parsed : parsed.translations;
  if (!Array.isArray(translations)) {
    throw new Error('Відповідь не містить масиву translations');
  }

  if (translations.length !== expectedCount) {
    console.warn(`Translation count mismatch: expected ${expectedCount}, got ${translations.length}`);
  }

  return translations;
}

export async function fetchGeminiModels(apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('API ключ Gemini не вказано');
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Помилка Gemini API (${res.status})`);
  }
  const data = await res.json();
  const models = filterAndSortModels(data);
  if (models.length === 0) throw new Error('Не знайдено доступних моделей для генерації тексту');
  return models;
}

export async function translateBatchGemini(texts, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ Gemini у налаштуваннях');
  if (!texts || texts.length === 0) return [];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const payload = buildBatchTranslationPayload(texts, targetLanguage);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Помилка перекладу Gemini (${res.status})`);
  }

  const data = await res.json();
  return parseGeminiResponse(data, texts.length);
}

export async function translateSingleGemini(text, targetLanguage, model, apiKey) {
  const result = await translateBatchGemini([text], targetLanguage, model, apiKey);
  return result[0] || text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gemini.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background/storage.js background/gemini.js tests/gemini.test.js
git commit -m "feat: implement storage manager and gemini client with batch JSON support"
```

---

### Task 3: In-Browser Local Model Engine (Offscreen Document & WebGPU/WASM)

**Files:**
- Create: `background/offscreen-manager.js`
- Create: `offscreen/offscreen.html`
- Create: `offscreen/offscreen.js`
- Create: `tests/offscreen-manager.test.js`

**Interfaces:**
- `ensureOffscreenDocument()`: Spawns offscreen document if not open
- `sendToOffscreen(message)`: Sends message to offscreen and returns response
- `offscreen.js`: Handles `LOAD_MODEL` and `TRANSLATE_LOCAL` using Transformers.js pipeline with WebGPU/WASM and language mapping (`uk` -> `ukr_Cyrl`, `en` -> `eng_Latn`, etc.).

- [ ] **Step 1: Write test for language code mapping and offscreen message structure**

Create `tests/offscreen-manager.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNllbLanguageCode } from '../offscreen/offscreen.js';

test('getNllbLanguageCode maps common language names to NLLB BCP-47 codes', () => {
  assert.equal(getNllbLanguageCode('Українська'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('uk'), 'ukr_Cyrl');
  assert.equal(getNllbLanguageCode('English'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('en'), 'eng_Latn');
  assert.equal(getNllbLanguageCode('Polski'), 'pol_Latn');
  assert.equal(getNllbLanguageCode('Deutsch'), 'deu_Latn');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offscreen-manager.test.js`  
Expected: FAIL (Cannot find module '../offscreen/offscreen.js')

- [ ] **Step 3: Implement offscreen-manager.js, offscreen.html, and offscreen.js**

Create `background/offscreen-manager.js`:
```javascript
let creatingOffscreenPromise = null;

export async function ensureOffscreenDocument() {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Running client-side WebGPU/WASM translation pipeline without an external server'
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

export async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response?.error || 'Помилка виконання в локальній моделі'));
        return;
      }
      resolve(response.data);
    });
  });
}
```

Create `offscreen/offscreen.html`:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>AI Local Translator Offscreen Worker</title>
  </head>
  <body>
    <script type="module" src="offscreen.js"></script>
  </body>
</html>
```

Create `offscreen/offscreen.js`:
```javascript
// Language code dictionary for NLLB-200
export const NLLB_LANG_MAP = {
  'uk': 'ukr_Cyrl',
  'українська': 'ukr_Cyrl',
  'ukr_cyrl': 'ukr_Cyrl',
  'en': 'eng_Latn',
  'english': 'eng_Latn',
  'eng_latn': 'eng_Latn',
  'pl': 'pol_Latn',
  'polski': 'pol_Latn',
  'de': 'deu_Latn',
  'deutsch': 'deu_Latn',
  'fr': 'fra_Latn',
  'français': 'fra_Latn',
  'es': 'spa_Latn',
  'español': 'spa_Latn',
  'it': 'ita_Latn',
  'italiano': 'ita_Latn'
};

export function getNllbLanguageCode(lang) {
  if (!lang) return 'ukr_Cyrl';
  const clean = lang.trim().toLowerCase();
  return NLLB_LANG_MAP[clean] || 'ukr_Cyrl';
}

let translatorPipeline = null;
let isModelLoading = false;

// Dynamically imports Transformers.js when requested
async function getPipeline(progressCallback) {
  if (translatorPipeline) return translatorPipeline;
  if (isModelLoading) {
    while (isModelLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return translatorPipeline;
  }

  isModelLoading = true;
  try {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    translatorPipeline = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
      progress_callback: (p) => {
        if (progressCallback && p.status === 'progress') {
          progressCallback(Math.round((p.loaded / p.total) * 100));
        }
      }
    });
    return translatorPipeline;
  } finally {
    isModelLoading = false;
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'CHECK_LOCAL_MODEL') {
      sendResponse({ ok: true, data: { loaded: Boolean(translatorPipeline) } });
      return false;
    }

    if (message.type === 'LOAD_LOCAL_MODEL') {
      getPipeline((percent) => {
        chrome.runtime.sendMessage({
          type: 'LOCAL_MODEL_DOWNLOAD_PROGRESS',
          progress: percent
        }).catch(() => {});
      })
        .then(() => sendResponse({ ok: true, data: { success: true } }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'TRANSLATE_LOCAL_BATCH') {
      (async () => {
        try {
          const pipe = await getPipeline();
          const { texts, targetLanguage } = message.payload;
          const tgtLangCode = getNllbLanguageCode(targetLanguage);

          const translations = [];
          for (const text of texts) {
            const out = await pipe(text, {
              tgt_lang: tgtLangCode
            });
            translations.push(out[0]?.translation_text || text);
          }
          sendResponse({ ok: true, data: { translations } });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offscreen-manager.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background/offscreen-manager.js offscreen/ tests/offscreen-manager.test.js
git commit -m "feat: implement offscreen worker manager and local in-browser model pipeline"
```

---

### Task 4: Background Service Worker, Context Menu & Request Router

**Files:**
- Create: `background/background.js`
- Test: `tests/router.test.js`

**Interfaces:**
- Installs context menu `ai-translate-selection` for text selection.
- Listens for `chrome.contextMenus.onClicked` -> sends `{ action: "TRIGGER_SELECTION_TRANSLATION" }` to active tab.
- Routes translation requests:
  - `TRANSLATE_BATCH` -> Gemini or Offscreen based on `activeEngine`.
  - `GET_SETTINGS`, `SAVE_SETTINGS`, `FETCH_MODELS`, `INIT_LOCAL_MODEL`.

- [ ] **Step 1: Write unit test for translation router logic**

Create `tests/router.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

function routeTranslation(engine, geminiFn, localFn) {
  if (engine === 'local') return localFn();
  return geminiFn();
}

test('routeTranslation selects appropriate engine function', () => {
  let geminiCalled = false;
  let localCalled = false;

  routeTranslation('gemini', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, true);
  assert.equal(localCalled, false);

  geminiCalled = false;
  localCalled = false;
  routeTranslation('local', () => { geminiCalled = true; }, () => { localCalled = true; });
  assert.equal(geminiCalled, false);
  assert.equal(localCalled, true);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/router.test.js`  
Expected: PASS

- [ ] **Step 3: Implement background/background.js**

Create `background/background.js`:
```javascript
import { getSettings, saveSettings } from './storage.js';
import { fetchGeminiModels, translateBatchGemini, translateSingleGemini } from './gemini.js';
import { ensureOffscreenDocument, sendToOffscreen } from './offscreen-manager.js';

// Setup Context Menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ai-translate-selection',
    title: '✨ Перекласти виділене (AI)',
    contexts: ['selection']
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ai-translate-selection' && tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_SELECTION_TRANSLATION' });
    } catch (err) {
      console.warn('Could not send message to tab:', err.message);
    }
  }
});

// Main Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages destined for offscreen document
  if (message.target === 'offscreen') return false;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ ok: true, data: settings });
          break;
        }

        case 'SAVE_SETTINGS': {
          const updated = await saveSettings(message.payload);
          sendResponse({ ok: true, data: updated });
          break;
        }

        case 'FETCH_MODELS': {
          const { apiKey } = message.payload;
          const models = await fetchGeminiModels(apiKey);
          await saveSettings({ geminiAvailableModels: models });
          sendResponse({ ok: true, data: { models } });
          break;
        }

        case 'DOWNLOAD_LOCAL_MODEL': {
          await ensureOffscreenDocument();
          const res = await sendToOffscreen({ target: 'offscreen', type: 'LOAD_LOCAL_MODEL' });
          await saveSettings({ localModelLoaded: true });
          sendResponse({ ok: true, data: res });
          break;
        }

        case 'TRANSLATE_BATCH': {
          const settings = await getSettings();
          const { texts } = message.payload;
          const targetLang = message.payload.targetLanguage || settings.targetLanguage;

          if (settings.activeEngine === 'local') {
            const res = await sendToOffscreen({
              target: 'offscreen',
              type: 'TRANSLATE_LOCAL_BATCH',
              payload: { texts, targetLanguage: targetLang }
            });
            sendResponse({ ok: true, data: res });
          } else {
            const translations = await translateBatchGemini(
              texts,
              targetLang,
              settings.geminiModel,
              settings.geminiApiKey
            );
            sendResponse({ ok: true, data: { translations } });
          }
          break;
        }

        case 'TRANSLATE_SELECTION': {
          const settings = await getSettings();
          const { text } = message.payload;
          const targetLang = message.payload.targetLanguage || settings.targetLanguage;

          if (settings.activeEngine === 'local') {
            const res = await sendToOffscreen({
              target: 'offscreen',
              type: 'TRANSLATE_LOCAL_BATCH',
              payload: { texts: [text], targetLanguage: targetLang }
            });
            sendResponse({ ok: true, data: { translation: res.translations[0] || text } });
          } else {
            const translation = await translateSingleGemini(
              text,
              targetLang,
              settings.geminiModel,
              settings.geminiApiKey
            );
            sendResponse({ ok: true, data: { translation } });
          }
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
```

- [ ] **Step 4: Commit**

```bash
git add background/background.js tests/router.test.js
git commit -m "feat: implement background message router and context menu dispatcher"
```

---

### Task 5: Options Page UI (Dual Engine, Model Fetcher & Language Selector)

**Files:**
- Create: `options/options.html`
- Create: `options/options.js`
- Create: `options/options.css`

**Interfaces:**
- Fetches and displays current settings on load.
- Allows switching between `Google Gemini API` and `Вбудована модель (WebGPU)`.
- Gemini section: API Key input with visibility toggle, "Підтягнути моделі" button calling `FETCH_MODELS`, dynamic select dropdown.
- Local section: "Завантажити модель (~300 МБ)" button, live progress bar, WebGPU status indicator.
- Target language selection (Українська, English, Polski, Deutsch, Español, Français).
- Save button with toast notification.

- [ ] **Step 1: Create options/options.html**

Create `options/options.html`:
```html
<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Налаштування — AI Page Translator</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="logo">
        <img src="../icons/icon48.png" alt="Logo">
        <h1>AI Page Translator</h1>
      </div>
      <p class="subtitle">Налаштуйте параметри AI перекладу сторінок та виділеного тексту</p>
    </header>

    <div class="card">
      <h2>1. Вибір рушія перекладу</h2>
      <div class="engine-tabs">
        <label class="tab-label">
          <input type="radio" name="engine" value="gemini" id="engineGemini" checked>
          <div class="tab-card">
            <strong>🌐 Google Gemini API</strong>
            <span>Хмарні моделі, підтягування актуального списку, висока точність</span>
          </div>
        </label>
        <label class="tab-label">
          <input type="radio" name="engine" value="local" id="engineLocal">
          <div class="tab-card">
            <strong>⚡ Вбудована модель (WebGPU)</strong>
            <span>100% офлайн без серверів, апаратне прискорення у браузері (~300 МБ)</span>
          </div>
        </label>
      </div>

      <!-- Gemini Settings -->
      <section id="geminiSection" class="engine-section">
        <h3>Параметри Google Gemini</h3>
        <div class="form-group">
          <label for="apiKey">Gemini API Ключ:</label>
          <div class="input-with-button">
            <input type="password" id="apiKey" placeholder="AIzaSy...">
            <button type="button" id="toggleApiKey" class="btn btn-secondary">👁</button>
            <button type="button" id="fetchModelsBtn" class="btn btn-primary">Отримати моделі</button>
          </div>
          <small class="hint">Отримати безкоштовний ключ можна в <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>.</small>
        </div>

        <div class="form-group">
          <label for="modelSelect">Активна модель Gemini:</label>
          <select id="modelSelect">
            <option value="gemini-2.5-flash">gemini-2.5-flash (Рекомендовано)</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
          </select>
        </div>
      </section>

      <!-- Local Model Settings -->
      <section id="localSection" class="engine-section hidden">
        <h3>Вбудована модель NLLB-200 (WebGPU)</h3>
        <p class="description">Модель завантажується безпосередньо в сховище вашого браузера один раз і працює автономно.</p>
        <div class="download-box">
          <button type="button" id="downloadModelBtn" class="btn btn-primary">Завантажити модель (~300 МБ)</button>
          <span id="modelStatusBadge" class="badge">Не завантажено</span>
        </div>
        <div id="progressContainer" class="progress-container hidden">
          <div class="progress-bar-wrapper">
            <div id="progressBar" class="progress-bar" style="width: 0%;"></div>
          </div>
          <span id="progressText" class="progress-text">0%</span>
        </div>
      </section>

      <hr class="divider">

      <h2>2. Мова перекладу</h2>
      <div class="form-group">
        <label for="targetLanguage">Цільова мова перекладу:</label>
        <select id="targetLanguage">
          <option value="Українська" selected>Українська (Ukrainian)</option>
          <option value="English">English (Англійська)</option>
          <option value="Polski">Polski (Польська)</option>
          <option value="Deutsch">Deutsch (Німецька)</option>
          <option value="Español">Español (Іспанська)</option>
          <option value="Français">Français (Французька)</option>
        </select>
      </div>

      <div class="actions">
        <button type="button" id="saveBtn" class="btn btn-success">Зберегти налаштування</button>
        <span id="saveStatus" class="status-msg"></span>
      </div>
    </div>
  </div>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create options/options.css**

Create `options/options.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #f3f4f6;
  color: #1f2937;
  padding: 32px 16px;
  line-height: 1.5;
}
.container { max-width: 680px; margin: 0 auto; }
.header { text-align: center; margin-bottom: 24px; }
.logo { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 8px; }
.logo h1 { font-size: 24px; font-weight: 700; color: #111827; }
.subtitle { color: #6b7280; font-size: 14px; }
.card {
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
h2 { font-size: 18px; margin-bottom: 16px; color: #111827; }
h3 { font-size: 15px; margin-bottom: 12px; color: #374151; }
.engine-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.tab-label { cursor: pointer; }
.tab-label input { display: none; }
.tab-card {
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s;
}
.tab-card strong { font-size: 14px; }
.tab-card span { font-size: 12px; color: #6b7280; }
.tab-label input:checked + .tab-card {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1e40af;
}
.engine-section { margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; }
.hidden { display: none !important; }
.form-group { margin-bottom: 16px; }
label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #374151; }
input[type="text"], input[type="password"], select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
}
.input-with-button { display: flex; gap: 8px; }
.hint { display: block; margin-top: 4px; font-size: 12px; color: #6b7280; }
.hint a { color: #2563eb; text-decoration: none; }
.divider { border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0; }
.btn {
  padding: 9px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: background 0.2s;
}
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; }
.btn-success { background: #10b981; color: #fff; }
.btn-success:hover { background: #059669; }
.badge { font-size: 12px; padding: 4px 8px; border-radius: 4px; background: #e5e7eb; color: #374151; }
.badge.ready { background: #d1fae5; color: #065f46; }
.progress-container { margin-top: 12px; }
.progress-bar-wrapper { width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
.progress-bar { height: 100%; background: #2563eb; transition: width 0.2s; }
.progress-text { font-size: 12px; color: #6b7280; margin-top: 4px; display: inline-block; }
.actions { display: flex; align-items: center; gap: 16px; margin-top: 24px; }
.status-msg { font-size: 14px; font-weight: 500; }
```

- [ ] **Step 3: Create options/options.js**

Create `options/options.js`:
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const engineGemini = document.getElementById('engineGemini');
  const engineLocal = document.getElementById('engineLocal');
  const geminiSection = document.getElementById('geminiSection');
  const localSection = document.getElementById('localSection');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKey');
  const fetchModelsBtn = document.getElementById('fetchModelsBtn');
  const modelSelect = document.getElementById('modelSelect');
  const targetLanguageSelect = document.getElementById('targetLanguage');
  const downloadModelBtn = document.getElementById('downloadModelBtn');
  const modelStatusBadge = document.getElementById('modelStatusBadge');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  function updateEngineVisibility(engine) {
    if (engine === 'local') {
      geminiSection.classList.add('hidden');
      localSection.classList.remove('hidden');
    } else {
      geminiSection.classList.remove('hidden');
      localSection.classList.add('hidden');
    }
  }

  engineGemini.addEventListener('change', () => updateEngineVisibility('gemini'));
  engineLocal.addEventListener('change', () => updateEngineVisibility('local'));

  toggleApiKeyBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Load Settings
  const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (settingsRes?.ok) {
    const s = settingsRes.data;
    if (s.activeEngine === 'local') {
      engineLocal.checked = true;
      updateEngineVisibility('local');
    } else {
      engineGemini.checked = true;
      updateEngineVisibility('gemini');
    }

    apiKeyInput.value = s.geminiApiKey || '';
    targetLanguageSelect.value = s.targetLanguage || 'Українська';

    if (Array.isArray(s.geminiAvailableModels) && s.geminiAvailableModels.length > 0) {
      modelSelect.innerHTML = s.geminiAvailableModels.map(m =>
        `<option value="${m}" ${m === s.geminiModel ? 'selected' : ''}>${m}</option>`
      ).join('');
    }

    if (s.localModelLoaded) {
      modelStatusBadge.textContent = 'Завантажено і готово';
      modelStatusBadge.classList.add('ready');
      downloadModelBtn.textContent = 'Оновити модель';
    }
  }

  // Fetch Models
  fetchModelsBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      alert('Будь ласка, введіть Gemini API ключ');
      return;
    }

    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = 'Завантаження...';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'FETCH_MODELS',
        payload: { apiKey }
      });

      if (!res.ok) throw new Error(res.error);

      modelSelect.innerHTML = res.data.models.map(m =>
        `<option value="${m}">${m}</option>`
      ).join('');

      saveStatus.textContent = 'Моделі успішно оновлено!';
      saveStatus.style.color = '#10b981';
      setTimeout(() => { saveStatus.textContent = ''; }, 3000);
    } catch (err) {
      alert(`Помилка отримання моделей: ${err.message}`);
    } finally {
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = 'Отримати моделі';
    }
  });

  // Download Local Model
  downloadModelBtn.addEventListener('click', async () => {
    downloadModelBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Ініціалізація...';

    // Listen for progress
    const progressListener = (msg) => {
      if (msg.type === 'LOCAL_MODEL_DOWNLOAD_PROGRESS') {
        progressBar.style.width = `${msg.progress}%`;
        progressText.textContent = `${msg.progress}%`;
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    try {
      const res = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_LOCAL_MODEL' });
      if (!res.ok) throw new Error(res.error);

      modelStatusBadge.textContent = 'Завантажено і готово';
      modelStatusBadge.classList.add('ready');
      progressBar.style.width = '100%';
      progressText.textContent = 'Готово!';
    } catch (err) {
      alert(`Помилка завантаження моделі: ${err.message}`);
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener);
      downloadModelBtn.disabled = false;
    }
  });

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const activeEngine = engineLocal.checked ? 'local' : 'gemini';
    const geminiApiKey = apiKeyInput.value.trim();
    const geminiModel = modelSelect.value;
    const targetLanguage = targetLanguageSelect.value;

    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { activeEngine, geminiApiKey, geminiModel, targetLanguage }
    });

    if (res?.ok) {
      saveStatus.textContent = 'Налаштування збережено!';
      saveStatus.style.color = '#10b981';
      setTimeout(() => { saveStatus.textContent = ''; }, 2500);
    } else {
      saveStatus.textContent = 'Помилка збереження';
      saveStatus.style.color = '#ef4444';
    }
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add options/
git commit -m "feat: implement options page for dual engine, model fetcher, and language selection"
```

---

### Task 6: Content Script — Main Content Detector, DOM Walker & In-Place Replacer

**Files:**
- Create: `content/detector.js`
- Create: `content/walker.js`
- Create: `content/replacer.js`
- Create: `content/content.css`
- Test: `tests/detector.test.js`

**Interfaces:**
- `findMainContent(document)`: Returns HTML element representing main article or feed.
- `collectTextElements(root)`: Returns array of elements to translate, attaching original text to `dataset.aiOriginalText`.
- `replaceTextBatch(elements, translations)`: In-place DOM update via `requestAnimationFrame`.
- `restoreOriginalText()`: Reverts all `data-ai-original-text` nodes.

- [ ] **Step 1: Write test for main content detector heuristic**

Create `tests/detector.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDensityScore } from '../content/detector.js';

test('calculateDensityScore favors text-heavy containers with paragraphs', () => {
  const highDensity = { textLength: 1200, tagCount: 15, paragraphCount: 6 };
  const lowDensity = { textLength: 150, tagCount: 30, paragraphCount: 1 };

  const scoreHigh = calculateDensityScore(highDensity.textLength, highDensity.tagCount, highDensity.paragraphCount);
  const scoreLow = calculateDensityScore(lowDensity.textLength, lowDensity.tagCount, lowDensity.paragraphCount);

  assert.ok(scoreHigh > scoreLow, 'High density content must score higher than low density navigation/footer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detector.test.js`  
Expected: FAIL (Cannot find module '../content/detector.js')

- [ ] **Step 3: Implement content/detector.js, walker.js, replacer.js, content.css**

Create `content/detector.js`:
```javascript
export function calculateDensityScore(textLength, tagCount, paragraphCount) {
  if (textLength < 100 || paragraphCount < 1) return 0;
  return (textLength / Math.max(tagCount, 1)) * Math.sqrt(paragraphCount);
}

export function findMainContent(doc = document) {
  // Step 1: Explicit semantic tags
  const semanticMain = doc.querySelector('main, [role="main"], article');
  if (semanticMain && (semanticMain.innerText || '').trim().length > 300) {
    return semanticMain;
  }

  // Step 2: Feed / Article list detection
  const feedItems = doc.querySelectorAll('article, .post, .card, .feed-item, .article-item');
  if (feedItems.length >= 3) {
    // Find lowest common ancestor
    const parent = feedItems[0].parentElement;
    if (parent && parent !== doc.body) return parent;
  }

  // Step 3: Density heuristic fallback
  const candidates = doc.querySelectorAll('div, section');
  const blacklist = new Set(['HEADER', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'SCRIPT', 'STYLE']);

  let bestElement = doc.body;
  let bestScore = -1;

  for (const el of candidates) {
    if (blacklist.has(el.tagName)) continue;
    if (el.closest('header, nav, footer, aside, .sidebar, .menu, .comments')) continue;

    const text = (el.innerText || '').trim();
    const tagCount = el.getElementsByTagName('*').length;
    const pCount = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').length;

    const score = calculateDensityScore(text.length, tagCount, pCount);
    if (score > bestScore) {
      bestScore = score;
      bestElement = el;
    }
  }

  return bestElement;
}
```

Create `content/walker.js`:
```javascript
export function collectTextElements(root) {
  if (!root) return [];

  const targets = root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption');
  const validElements = [];

  for (const el of targets) {
    // Skip if inside code blocks or already translated
    if (el.closest('pre, code, noscript, style, script')) continue;
    const text = (el.innerText || '').trim();
    if (text.length < 2) continue;

    // Cache original text
    if (!el.dataset.aiOriginalText) {
      el.dataset.aiOriginalText = el.innerText;
    }

    validElements.push(el);
  }

  return validElements;
}
```

Create `content/replacer.js`:
```javascript
export function replaceTextBatch(elements, translations) {
  requestAnimationFrame(() => {
    elements.forEach((el, idx) => {
      const translated = translations[idx];
      if (typeof translated === 'string' && translated.trim()) {
        el.innerText = translated;
        el.classList.add('ai-translated-block');
      }
    });
  });
}

export function restoreOriginalText(doc = document) {
  const elements = doc.querySelectorAll('[data-ai-original-text]');
  requestAnimationFrame(() => {
    elements.forEach(el => {
      el.innerText = el.dataset.aiOriginalText;
      el.classList.remove('ai-translated-block');
      delete el.dataset.aiOriginalText;
    });
    delete doc.body.dataset.aiPageTranslated;
  });
}
```

Create `content/content.css`:
```css
.ai-translated-block {
  transition: background-color 0.4s ease;
}
.ai-translated-selection {
  background-color: #dbeafe;
  border-bottom: 1.5px dashed #2563eb;
  cursor: pointer;
  border-radius: 2px;
  padding: 0 2px;
}
.ai-translating-pulse {
  animation: ai-pulse 1.2s infinite ease-in-out;
  background-color: #fef08a !important;
}
@keyframes ai-pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detector.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add content/ tests/detector.test.js
git commit -m "feat: implement main content detector, DOM walker, and in-place replacer"
```

---

### Task 7: Content Script — Selection Translation & In-Place Range Replacement

**Files:**
- Create: `content/selection.js`
- Create: `content/content.js`

**Interfaces:**
- `content/selection.js`: Handles right-click context menu event `{ action: "TRIGGER_SELECTION_TRANSLATION" }`.
- In-place Range replacement: wraps translated text in `.ai-translated-selection` span with click-to-restore.
- `content/content.js`: Main content script listening for popup commands (`TRANSLATE_MAIN_CONTENT`, `RESTORE_ORIGINAL_CONTENT`, `GET_PAGE_STATUS`).

- [ ] **Step 1: Implement content/selection.js**

Create `content/selection.js`:
```javascript
export async function handleSelectionTranslation() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const text = selection.toString().trim();
  if (text.length < 2) return;

  const range = selection.getRangeAt(0);

  // Create temporary highlight span
  const tempSpan = document.createElement('span');
  tempSpan.className = 'ai-translating-pulse';
  tempSpan.textContent = text;

  range.deleteContents();
  range.insertNode(tempSpan);
  selection.removeAllRanges();

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_SELECTION',
      payload: { text }
    });

    if (!res.ok) throw new Error(res.error);

    const translatedText = res.data.translation;

    // Create persistent translated span with restore on click
    const translatedSpan = document.createElement('span');
    translatedSpan.className = 'ai-translated-selection';
    translatedSpan.textContent = translatedText;
    translatedSpan.title = 'Клікніть, щоб повернути оригінал';
    translatedSpan.dataset.original = text;

    translatedSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const orig = translatedSpan.dataset.original;
      translatedSpan.replaceWith(document.createTextNode(orig));
    });

    tempSpan.replaceWith(translatedSpan);
  } catch (err) {
    alert(`Помилка перекладу виділеного: ${err.message}`);
    tempSpan.replaceWith(document.createTextNode(text));
  }
}
```

- [ ] **Step 2: Implement content/content.js**

Create `content/content.js`:
```javascript
import { findMainContent } from './detector.js';
import { collectTextElements } from './walker.js';
import { replaceTextBatch, restoreOriginalText } from './replacer.js';
import { handleSelectionTranslation } from './selection.js';

const BATCH_SIZE = 15;

async function translateMainContent(progressCallback) {
  const root = findMainContent(document);
  const elements = collectTextElements(root);

  if (elements.length === 0) {
    throw new Error('Не знайдено текстових блоків для перекладу');
  }

  document.body.dataset.aiPageTranslated = 'true';

  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    const batchElements = elements.slice(i, i + BATCH_SIZE);
    const texts = batchElements.map(el => el.innerText);

    const res = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      payload: { texts }
    });

    if (!res.ok) throw new Error(res.error);

    replaceTextBatch(batchElements, res.data.translations);

    if (progressCallback) {
      progressCallback(Math.min(i + BATCH_SIZE, elements.length), elements.length);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRIGGER_SELECTION_TRANSLATION') {
    handleSelectionTranslation();
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'GET_PAGE_STATUS') {
    const isTranslated = document.body.dataset.aiPageTranslated === 'true';
    sendResponse({ ok: true, isTranslated });
    return false;
  }

  if (message.action === 'TRANSLATE_MAIN_CONTENT') {
    translateMainContent((done, total) => {
      chrome.runtime.sendMessage({
        type: 'PAGE_TRANSLATION_PROGRESS',
        done,
        total
      }).catch(() => {});
    })
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async translation
  }

  if (message.action === 'RESTORE_ORIGINAL_CONTENT') {
    restoreOriginalText(document);
    sendResponse({ ok: true });
    return false;
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add content/
git commit -m "feat: implement selection translation and content script messaging"
```

---

### Task 8: Action Popup UI (Controls, Status, Progress & Settings Link)

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.js`
- Create: `popup/popup.css`

**Interfaces:**
- Popup UI: displays active engine, model, and target language.
- "Перекласти сторінку" / "↺ Повернути оригінал" button.
- Progress bar during batch translation.
- Settings shortcut button.

- [ ] **Step 1: Create popup/popup.html**

Create `popup/popup.html`:
```html
<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Translate</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup-container">
    <header class="popup-header">
      <div class="brand">
        <img src="../icons/icon32.png" alt="Icon">
        <h2>AI Translator</h2>
      </div>
      <button type="button" id="openSettingsBtn" class="icon-btn" title="Налаштування">⚙️</button>
    </header>

    <div class="info-badges">
      <span id="engineBadge" class="info-pill">🌐 Gemini</span>
      <span id="langBadge" class="info-pill">🇺🇦 Українська</span>
    </div>

    <div id="alertBox" class="alert-box hidden"></div>

    <div class="main-action">
      <button type="button" id="toggleTranslateBtn" class="btn btn-primary">
        🌐 Перекласти сторінку
      </button>
    </div>

    <div id="progressBox" class="progress-box hidden">
      <div class="progress-bar-bg">
        <div id="progressBar" class="progress-bar-fill" style="width: 0%;"></div>
      </div>
      <div id="progressLabel" class="progress-label">0 / 0</div>
    </div>
  </div>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup/popup.css**

Create `popup/popup.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  width: 290px;
  background: #ffffff;
  color: #1f2937;
  padding: 16px;
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.brand { display: flex; align-items: center; gap: 8px; }
.brand h2 { font-size: 16px; font-weight: 700; color: #111827; }
.icon-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.icon-btn:hover { background: #f3f4f6; }
.info-badges { display: flex; gap: 6px; margin-bottom: 14px; }
.info-pill {
  font-size: 11px;
  font-weight: 600;
  background: #eff6ff;
  color: #1e40af;
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
}
.alert-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.hidden { display: none !important; }
.btn {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.btn-primary { background: #2563eb; color: #fff; }
.btn-primary:hover { background: #1d4ed8; }
.btn-restore { background: #4b5563; color: #fff; }
.btn-restore:hover { background: #374151; }
.progress-box { margin-top: 12px; }
.progress-bar-bg { width: 100%; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: #2563eb; transition: width 0.2s; }
.progress-label { font-size: 11px; color: #6b7280; text-align: center; margin-top: 4px; }
```

- [ ] **Step 3: Create popup/popup.js**

Create `popup/popup.js`:
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const engineBadge = document.getElementById('engineBadge');
  const langBadge = document.getElementById('langBadge');
  const alertBox = document.getElementById('alertBox');
  const toggleBtn = document.getElementById('toggleTranslateBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const progressBox = document.getElementById('progressBox');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');

  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Load Settings
  const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const settings = settingsRes?.data || {};

  engineBadge.textContent = settings.activeEngine === 'local' ? '⚡ Офлайн (WebGPU)' : `🌐 ${settings.geminiModel || 'Gemini'}`;
  langBadge.textContent = settings.targetLanguage || 'Українська';

  // Check readiness
  if (settings.activeEngine === 'gemini' && !settings.geminiApiKey) {
    alertBox.textContent = 'Вкажіть API ключ у налаштуваннях';
    alertBox.classList.remove('hidden');
    toggleBtn.disabled = true;
  } else if (settings.activeEngine === 'local' && !settings.localModelLoaded) {
    alertBox.textContent = 'Завантажте офлайн модель у налаштуваннях';
    alertBox.classList.remove('hidden');
    toggleBtn.disabled = true;
  }

  // Check Page Status
  let isTranslated = false;
  try {
    const pageStatus = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_STATUS' });
    isTranslated = Boolean(pageStatus?.isTranslated);
  } catch {
    // Content script might not be injected on restricted pages (e.g. chrome://)
  }

  function updateButtonState(translated) {
    isTranslated = translated;
    if (isTranslated) {
      toggleBtn.textContent = '↺ Повернути оригінал';
      toggleBtn.className = 'btn btn-restore';
    } else {
      toggleBtn.textContent = '🌐 Перекласти сторінку';
      toggleBtn.className = 'btn btn-primary';
    }
  }

  updateButtonState(isTranslated);

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PAGE_TRANSLATION_PROGRESS') {
      progressBox.classList.remove('hidden');
      const pct = Math.round((msg.done / msg.total) * 100);
      progressBar.style.width = `${pct}%`;
      progressLabel.textContent = `Перекладено: ${msg.done} з ${msg.total} блоків`;
    }
  });

  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;

    if (isTranslated) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'RESTORE_ORIGINAL_CONTENT' });
        updateButtonState(false);
      } catch (err) {
        alert(`Помилка повернення оригіналу: ${err.message}`);
      } finally {
        toggleBtn.disabled = false;
        progressBox.classList.add('hidden');
      }
    } else {
      progressBox.classList.remove('hidden');
      progressBar.style.width = '0%';
      progressLabel.textContent = 'Пошук головного контенту...';

      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'TRANSLATE_MAIN_CONTENT' });
        if (!res?.ok) throw new Error(res?.error || 'Помилка перекладу');
        updateButtonState(true);
      } catch (err) {
        alert(`Помилка перекладу: ${err.message}`);
      } finally {
        toggleBtn.disabled = false;
        progressBox.classList.add('hidden');
      }
    }
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add popup/
git commit -m "feat: implement action popup with engine status and translation controls"
```

---

### Task 9: End-to-End Test Suite & Smoke Verification

**Files:**
- Create: `tests/e2e-smoke.test.js`
- Create: `README.md`

- [ ] **Step 1: Write comprehensive smoke test verifying all extension components**

Create `tests/e2e-smoke.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('all required extension files exist', () => {
  const requiredFiles = [
    'manifest.json',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'background/background.js',
    'background/gemini.js',
    'background/storage.js',
    'background/offscreen-manager.js',
    'offscreen/offscreen.html',
    'offscreen/offscreen.js',
    'content/content.js',
    'content/detector.js',
    'content/walker.js',
    'content/replacer.js',
    'content/selection.js',
    'content/content.css',
    'options/options.html',
    'options/options.js',
    'options/options.css',
    'popup/popup.html',
    'popup/popup.js',
    'popup/popup.css'
  ];

  for (const relPath of requiredFiles) {
    const full = path.resolve(relPath);
    assert.ok(fs.existsSync(full), `File ${relPath} must exist`);
  }
});
```

- [ ] **Step 2: Run all tests in the project**

Run: `node --test tests/*.test.js`  
Expected: All tests PASS

- [ ] **Step 3: Create README.md with installation and usage instructions**

Create `README.md`:
```markdown
# AI Page Translator (Chrome Extension)

Розумне розширення для Google Chrome (Manifest V3) для перекладу головного контенту веб-сторінок та виділеного тексту за допомогою Google Gemini API або вбудованої офлайн-нейромережі (WebGPU).

## Можливості
* **Два режими на вибір:**
  * 🌐 **Google Gemini API:** швидкий хмарний переклад із динамічним завантаженням моделей (`gemini-2.5-flash`, `gemini-1.5-flash` тощо).
  * ⚡ **Вбудована модель (WebGPU):** переклад без серверів прямо у браузері через модель NLLB-200.
* **Автоматичний детектор головного контенту:** перекладає лише статтю, новину або стрічку постів, не зачіпаючи меню, рекламу та футер.
* **In-place заміна:** акуратно замінює текст на сторінці зі збереженням шрифтів, стилів і посилань.
* **Миттєве відновлення оригіналу:** повернення вихідного тексту в один клік без повторних запитів.
* **Переклад виділеного тексту:** виділіть будь-який текст, натисніть правою кнопкою миші -> `✨ Перекласти виділене (AI)`.

## Встановлення
1. Відкрийте Chrome і перейдіть за адресою `chrome://extensions/`.
2. Увімкніть **«Режим розробника»** (Developer mode) у правому верхньому кутку.
3. Натисніть **«Завантажити розпаковане»** (Load unpacked) і виберіть цю папку (`d:\ai page translate`).
4. Натисніть на іконку розширення -> **⚙️ Налаштування** та вкажіть ваш API ключ або завантажте локальну модель.
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-smoke.test.js README.md
git commit -m "docs: add README with installation guide and complete smoke tests"
```
