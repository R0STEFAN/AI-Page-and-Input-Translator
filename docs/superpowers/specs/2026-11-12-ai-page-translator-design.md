# AI Page Translator Chrome Extension — Design Specification

**Date:** 2026-11-12  
**Target Platform:** Google Chrome (Manifest V3)  
**Dual Translation Engines:** 
1. **Cloud AI:** Google Gemini API (`generativelanguage.googleapis.com`)
2. **In-Browser Local AI (No server required):** WebGPU / WASM with `Transformers.js` + quantized `NLLB-200` (~300 MB cached in browser)
**Repository:** `d:\ai page translate`

---

## 1. Overview & Problem Statement

Users require a privacy-conscious, high-performance browser translation extension that:
1. Supports **two translation modes**:
   * **Cloud Mode (Google Gemini API):** User enters an API key, the extension dynamically fetches all active models (`gemini-2.5-flash`, `gemini-1.5-flash`, etc.), and user selects their preferred model and target language.
   * **Built-in Local Mode (WebGPU / In-Browser Offline):** Zero external servers, zero background daemons. The user downloads a compact, specialized translation model (quantized `NLLB-200-distilled-600M` ~300 MB) directly into the browser cache during initial setup. All translations run 100% locally on the user's GPU (via WebGPU) or CPU (via multi-threaded WASM).
2. Automatically identifies the **main content** of any web page (article, blog post, or article list/feed) without translating distracting sidebars, headers, navigation menus, ads, or footers.
3. Performs an **in-place DOM replacement** of the main content into the target language, preserving layout, CSS styling, links, and structure, with an instant single-click option to revert to the original text.
4. Provides **selection translation via right-click context menu** (`✨ Перекласти виділене (AI)`), translating only the selected text and replacing it directly in-place on the page.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                            │
├───────────────────────────────────┬────────────────────────────────────┤
│           Options Page            │             Popup UI               │
│     (options.html / .js)          │        (popup.html / .js)          │
│ • Engine switch: Gemini vs Local  │ • Translate Main / Restore button  │
│ • Gemini: API Key & dynamic models│ • Status & Progress indicator      │
│ • Local: Download model (progress)│ • Active Engine & Language badge   │
│ • Target Language selection       │ • Quick settings button            │
└─────────────────┬─────────────────┴──────────────────┬─────────────────┘
                  │                                    │
                  ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Background Service Worker (`background.js`)          │
│ • chrome.contextMenus setup ("✨ Перекласти виділене (AI)")            │
│ • Route translation requests according to selected active engine:      │
│     ├─► [Engine: Gemini] ──► Gemini API REST Client (lib/gemini.js)    │
│     └─► [Engine: Local]  ──► chrome.offscreen Document (WebGPU/WASM)   │
│ • chrome.storage.sync management (fallback local)                      │
│ • Offscreen lifecycle manager (spawns/manages offscreen document)      │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │                                          │
               ▼                                          ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│  Offscreen Worker Document           │   │ Content Script Layer        │
│  (offscreen.html / offscreen.js)     │   │ (content/content.js)        │
│ • Transformers.js runtime            │   │ • detector.js (Main Content)│
│ • WebGPU / WASM execution            │   │ • walker.js (DOM TextNodes) │
│ • Local NLLB-200 pipeline            │   │ • replacer.js (In-place)    │
│ • One-click model downloader & cache │   │ • selection.js (Right-click)│
└──────────────────────────────────────┘   └─────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1. Manifest V3 (`manifest.json`)
* **`manifest_version`**: `3`
* **`name`**: `AI Page Translator`
* **`version`**: `1.0.0`
* **`description`**: `Розумний перекладач сторінок та виділеного тексту за допомогою Google Gemini та вбудованої офлайн-нейромережі.`
* **`permissions`**:
  * `"storage"`: Persisting user preferences (`activeEngine`, `geminiApiKey`, `geminiModel`, `targetLanguage`, `localModelInstalled`).
  * `"contextMenus"`: Registering the selection translation right-click menu item.
  * `"activeTab"`: Communicating with the active tab.
  * `"offscreen"`: Required for hosting WebGPU and Transformers.js client-side inference in Manifest V3.
* **`host_permissions`**:
  * `"https://generativelanguage.googleapis.com/*"`: Gemini API requests.
  * `"https://huggingface.co/*"` and `"https://*.hf.co/*"`: One-time model asset download for in-browser local model.
* **`background`**:
  * `"service_worker"`: `"background/background.js"`, `"type"`: `"module"`.
* **`action`**:
  * `"default_popup"`: `"popup/popup.html"`
  * `"default_icon"`: 16, 32, 48, 128 px icons.
* **`options_page`**: `"options/options.html"`
* **`content_scripts`**:
  * Matches: `["<all_urls>"]`
  * JS: `["content/content.js"]`
  * Run at: `"document_idle"`

---

### 3.2. Settings & Translation Engines

#### Storage Schema (`chrome.storage.sync` with `local` fallback)
```json
{
  "activeEngine": "gemini", // "gemini" | "local"
  "geminiApiKey": "AIzaSy...",
  "geminiModel": "gemini-2.5-flash",
  "geminiAvailableModels": ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  "targetLanguage": "uk", // "uk" | "en" | "pl" | "de" | "es" | "fr"
  "localModelLoaded": false
}
```

#### Engine 1: Cloud Google Gemini (`background/gemini.js`)
* **Dynamic Model Discovery:**
  * `GET https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  * Filters models supporting `generateContent`. Flash models (`gemini-2.5-flash`, `gemini-1.5-flash`) are prioritized at the top of the select list.
* **Batch Translation:**
  * `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  * Uses structured JSON response (`responseMimeType: "application/json"`) with a schema returning `{"translations": ["...", "..."]}` for reliable index-matched text replacement.

#### Engine 2: In-Browser Local Model (Offscreen Document with Transformers.js & WebGPU)
* **Zero External Dependencies:** No Python, no Ollama, no background processes.
* **Model:** Quantized `Xenova/nllb-200-distilled-600M` (ONNX format, ~300 MB). Supports Ukrainian (`ukr_Cyrl`), English, and 200 other languages with state-of-the-art NMT quality.
* **Storage & Download:**
  * Download initiated via button in Options page.
  * Offscreen document uses `transformers.pipeline('translation', 'Xenova/nllb-200-distilled-600M', { progress_callback: ... })`.
  * Sends progress updates (`0%` -> `100%`) to the Options UI.
  * Weights are automatically cached in browser `CacheStorage` / `IndexedDB` and loaded instantly on subsequent runs.
* **Hardware Acceleration:**
  * Checks for WebGPU support: `navigator.gpu`. If available, sets `device: 'webgpu'`, enabling blazing-fast hardware-accelerated translation.
  * Fallback: WASM with SIMD for systems without WebGPU.

---

### 3.3. Main Content Detection & In-Place DOM Replacement (`content/`)

#### 1. Detection Heuristic (`detector.js`)
* **Step 1 (Semantic Container):** Check for `<main>`, `[role="main"]`, or `<article>`. If found and text length > 300 characters, use as root.
* **Step 2 (Article Feeds / Blog Lists):** Locate repeating item containers (e.g. 3+ `<article>`, `.post`, `.card`, `.news-item` elements) and select their closest common ancestor.
* **Step 3 (Density Scoring):** For unstructured layouts, scan top-level containers (`div`, `section`), exclude headers, footers, navs, sidebars, ads, and forms, and calculate `score = (textLength / Math.max(tagCount, 1)) * Math.sqrt(paragraphCount)`.

#### 2. Text Extraction & In-Place Replacement (`walker.js` & `replacer.js`)
* Traverses block text elements (`p`, `h1`-`h6`, `li`, `blockquote`, `figcaption`).
* Skips `pre`, `code`, and empty elements.
* Caches original text: `el.dataset.aiOriginalText = el.innerText`.
* Batches text into chunks of 15–20 elements (~2,500 characters) for progressive streaming.
* In-place replacement updates DOM nodes inside `requestAnimationFrame` as each batch completes.
* **Restore Original:** Single click in popup restores `el.textContent = el.dataset.aiOriginalText` for all elements instantly with zero network/GPU calls.

---

### 3.4. Selection Translation via Context Menu (`content/selection.js`)

* **Context Menu Entry:** Created via `chrome.contextMenus.create` on extension install:
  * `id: "ai-translate-selection"`, `title: "✨ Перекласти виділене (AI)"`, `contexts: ["selection"]`.
* **Flow:**
  1. User selects text on page -> right clicks -> selects `✨ Перекласти виділене (AI)`.
  2. Background receives click event -> passes message to active tab content script.
  3. `selection.js` gets `window.getSelection()`, applies temporary subtle pulse/highlight class.
  4. Dispatches text translation to background (routes to active engine: Gemini or Local NLLB).
  5. On completion: `range.deleteContents()`, inserts `<span class="ai-translated-selection" title="Клікніть, щоб повернути оригінал">${translatedText}</span>` containing `dataset.originalText`.
  6. Clicking the translated span instantly restores the original text.

---

### 3.5. Popup UI (`popup/`)

* **Header:** Displays active engine badge (`🌐 Gemini: gemini-2.5-flash` or `⚡ Офлайн (WebGPU)`) and target language (`🌐 Мова: Українська`).
* **Primary Action:**
  * **"🌐 Перекласти головний контент"** (toggles to **"↺ Повернути оригінал"** when translated).
* **Progress Bar:** Real-time indicator during full-page translation (`Перекладено: 12 / 36 блоків`).
* **Secondary Action:** **"⚙️ Налаштування"** opens Options tab.
* **Setup Warning:** Prompts if Gemini API key is missing or if Local model is not yet downloaded.

---

## 4. File Structure

```
d:\ai page translate\
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   ├── background.js
│   ├── gemini.js
│   └── offscreen-manager.js
├── offscreen/
│   ├── offscreen.html
│   ├── offscreen.js
│   └── vendor/
│       └── transformers.min.js
├── content/
│   ├── content.js
│   ├── detector.js
│   ├── walker.js
│   ├── replacer.js
│   ├── selection.js
│   └── content.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-11-12-ai-page-translator-design.md
```

---

## 5. Verification & Testing Strategy

1. **Options Engine Switch & Setup:**
   * Test Cloud Engine: Input Gemini API key -> click "Отримати доступні моделі" -> verify dynamic list (`gemini-2.5-flash`, etc.).
   * Test Local Engine: Switch to "Вбудована модель (Офлайн / WebGPU)" -> click "Завантажити модель (~300 МБ)" -> observe progress bar -> verify model persists in browser cache.
2. **Main Content Page Translation:**
   * Test with Gemini engine and test with Local engine on Wikipedia, blogs, and news feeds.
   * Verify main content is accurately replaced in-place while headers, navigation, and sidebars remain untouched.
   * Verify "Повернути оригінал" restores original text instantly.
3. **Selection Context Menu Translation:**
   * Highlight text -> right-click -> "✨ Перекласти виділене (AI)" -> verify in-place replacement.
   * Click translated span -> verify revert to original text.
