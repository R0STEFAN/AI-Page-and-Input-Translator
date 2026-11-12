# AI Page Translator Chrome Extension — Design Specification

**Date:** 2026-11-12  
**Target Platform:** Google Chrome (Manifest V3)  
**AI Engine:** Google Gemini API (`generativelanguage.googleapis.com`)  
**Repository:** `d:\ai page translate`

---

## 1. Overview & Problem Statement

Users require an AI-powered browser translation extension that:
1. Connects to Google Gemini API using a personal API key.
2. Dynamically queries the API to fetch all active available models (e.g., `gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`) and enables the user to select their desired model and target translation language in an intuitive Options page.
3. Automatically identifies the **main content** of any web page (article, blog post, or article list/feed) without translating distracting sidebars, headers, navigation menus, ads, or footers.
4. Performs an **in-place DOM replacement** of the main content into the target language, preserving layout, CSS styling, links, and structure, with an instant single-click option to revert to the original text.
5. Provides **selection translation via right-click context menu** (`✨ Перекласти виділене (AI)`), which translates only the selected text and replaces it directly in-place on the page.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                            │
├───────────────────────────────────┬────────────────────────────────────┤
│           Options Page            │             Popup UI               │
│     (options.html / .js)          │        (popup.html / .js)          │
│ • Gemini API Key input            │ • Translate Main / Restore button  │
│ • Fetch Models dynamically        │ • Status & Progress indicator      │
│ • Select Model & Target Language  │ • Quick settings button            │
└─────────────────┬─────────────────┴──────────────────┬─────────────────┘
                  │                                    │
                  ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Background Service Worker (`background.js`)          │
│ • chrome.contextMenus setup ("Перекласти виділене (AI)")               │
│ • Gemini API Client:                                                   │
│     - fetchModels(apiKey)                                              │
│     - translateBatch(texts, targetLanguage, model, apiKey)             │
│     - translateSingle(text, targetLanguage, model, apiKey)            │
│ • chrome.storage.sync management (fallback local)                      │
│ • Message broker between Popup, Content Script, and Gemini API         │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ chrome.tabs.sendMessage
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 Content Script Layer (`content/content.js`)            │
│                                                                        │
│  ┌───────────────────────┐         ┌────────────────────────────────┐  │
│  │     detector.js       │         │           walker.js            │  │
│  │ • Find <main>/<article>│         │ • Extract text-bearing leaf    │  │
│  │ • Article feed scanner│ ──────> │   nodes (p, h1-h6, li, etc.)   │  │
│  │ • Density-score fallback│       │ • Assign data-ai-trans-id      │  │
│  └───────────────────────┘         │ • Cache data-ai-original-text  │  │
│                                    └───────────────┬────────────────┘  │
│                                                    │                   │
│  ┌───────────────────────┐         ┌───────────────▼────────────────┐  │
│  │     selection.js      │         │          replacer.js           │  │
│  │ • Context menu action │         │ • Progressive batch streaming  │  │
│  │ • window.getSelection │         │ • In-place DOM node update     │  │
│  │ • In-place Range swap │         │ • Instant restore to original  │  │
│  └───────────────────────┘         └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1. Manifest V3 (`manifest.json`)
* **`manifest_version`**: `3`
* **`name`**: `AI Page Translator`
* **`version`**: `1.0.0`
* **`description`**: `Розумний перекладач сторінок та виділеного тексту за допомогою Google Gemini AI.`
* **`permissions`**:
  * `"storage"`: Persisting user settings (`apiKey`, `selectedModel`, `targetLanguage`).
  * `"contextMenus"`: Registering the selection translation right-click menu item.
  * `"activeTab"`: Communicating with the active page on user action.
* **`host_permissions`**:
  * `"https://generativelanguage.googleapis.com/*"`: Direct HTTPS access to Gemini REST API endpoints from background service worker.
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

### 3.2. Settings & Gemini Integration (`options/` & `background/gemini.js`)

#### Storage Schema (`chrome.storage.sync` with `local` fallback)
```json
{
  "apiKey": "AIzaSy...",
  "selectedModel": "gemini-2.5-flash",
  "targetLanguage": "Українська",
  "availableModels": ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
}
```

#### API Endpoints & Request Contracts
1. **Model Discovery:**
   * **Endpoint:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
   * **Filter:** Select entries where `supportedGenerationMethods` includes `"generateContent"` and name does not contain embedding/vision-only keywords.
   * **Sorting:** Prefer flash / fast models (`gemini-2.5-flash`, `gemini-1.5-flash`) at the top.

2. **Batch Translation:**
   * **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
   * **Headers:** `Content-Type: application/json`
   * **Body:**
     ```json
     {
       "contents": [
         {
           "role": "user",
           "parts": [
             {
               "text": "Translate the following JSON array of strings into ${targetLanguage}. Maintain formatting, numbers, code tokens, and URLs accurately. Return strict JSON matching the schema.\n\nInput:\n${JSON.stringify(texts)}"
             }
           ]
         }
       ],
       "generationConfig": {
         "temperature": 0.2,
         "responseMimeType": "application/json",
         "responseSchema": {
           "type": "OBJECT",
           "properties": {
             "translations": {
               "type": "ARRAY",
               "items": { "type": "STRING" }
             }
           },
           "required": ["translations"]
         }
       }
     }
     ```
   * **Response Handling:** Extracts `candidates[0].content.parts[0].text`, parses JSON, verifies `translations.length === texts.length`.

---

### 3.3. Main Content Detection & DOM Handling (`content/`)

#### 1. Detection Heuristic (`detector.js`)
* **Step 1 (Explicit Semantic Tags):**
  * Check for `<main>`, `[role="main"]`, or `<article>`.
  * If found and text length > 300 characters, designate as main container.
* **Step 2 (Article Feeds / Blog Lists):**
  * If the page contains multiple repeated items (e.g. `document.querySelectorAll('article, .post, .card, .feed-item')` with count >= 3), locate their lowest common ancestor container.
* **Step 3 (Text Density Scoring Fallback):**
  * Inspect top-level candidate containers (`div`, `section`).
  * Exclude blacklist elements: `header`, `nav`, `footer`, `aside`, `.sidebar`, `.menu`, `.advertisement`, `.comments`, `form`, `script`, `style`.
  * Score = `(textLength / Math.max(tagCount, 1)) * Math.sqrt(paragraphCount)`.
  * The highest scoring element becomes the translation root.

#### 2. Text Extraction & In-Place Replacement (`walker.js` & `replacer.js`)
* Walk only block elements (`p`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `li`, `blockquote`, `figcaption`, `dt`, `dd`).
* Filter out empty or whitespace-only nodes and `pre`/`code` blocks.
* Store original text: `el.dataset.aiOriginalText = el.innerText`.
* Assign unique batch tracking ID: `el.dataset.aiTransId = id`.
* Batching: Slice elements into batches of 15–20 elements (~2,500 characters).
* Progressive rendering:
  * For each batch, send to background service worker.
  * On response, update each element's `textContent` inside `requestAnimationFrame`.
  * Store translated state in `document.body.dataset.aiPageTranslated = "true"`.
* Restore functionality:
  * Query all elements with `[data-ai-original-text]`.
  * Restore `el.textContent = el.dataset.aiOriginalText`.
  * Remove `document.body.dataset.aiPageTranslated`.

---

### 3.4. Selection Translation via Context Menu (`content/selection.js`)

* **Context Menu Entry:** Created via `chrome.contextMenus.create` on install with `id: "ai-translate-selection"`, `title: "✨ Перекласти виділене (AI)"`, `contexts: ["selection"]`.
* **Execution Flow:**
  1. User selects text and clicks context menu item.
  2. Background receives `chrome.contextMenus.onClicked` -> sends message `{ action: "TRANSLATE_SELECTION" }` to active tab.
  3. `content/selection.js` captures `window.getSelection()`.
  4. Selected text is extracted; a subtle highlight/pulse is applied to the selection range.
  5. Content script requests translation from background for single text.
  6. On response, `range.deleteContents()` is executed and replaced with a `<span class="ai-translated-selection" title="Клікніть, щоб повернути оригінал">${translation}</span>` element containing `dataset.originalText`.
  7. Clicking on the translated selection span reverts it to original text.

---

### 3.5. Popup UI (`popup/`)

* **Status Header:** Displays current target language and active model.
* **Action Buttons:**
  * **"🌐 Перекласти сторінку"** (switches to **"↺ Повернути оригінал"** when page is already translated).
  * **"⚙️ Налаштування"** (opens Options page).
* **Progress Bar:** Shown during active translation: `Перекладено X / Y блоків...`
* **Notice Banner:** Shown if API key is not configured, linking directly to Options.

---

## 4. Error Handling & Edge Cases

| Scenario | Handling Strategy |
|----------|-------------------|
| API Key missing | Options page & Popup show prominent warning; blocks translation requests with a clean prompt to configure the key. |
| Invalid API Key / Quota Exceeded | Catches HTTP 400/403/429 from Gemini; surfaces localized error message ("Перевірте API ключ або ліміти Gemini"). |
| No main content found | Falls back to visible `document.body` paragraphs while skipping navigation/header/footer elements. |
| Translation count mismatch | If Gemini returns fewer/more items than requested, falls back to 1-to-1 matching up to available length. |
| Dynamic/SPA navigation | Re-checks page state on user-initiated popup click. |
| User reverts page | Instant restoration from `dataset.aiOriginalText` with zero network requests. |

---

## 5. File Structure

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
│   └── gemini.js
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

## 6. Verification & Testing Strategy

1. **Options Page Verification:**
   - Enter valid Gemini API key -> click "Отримати доступні моделі" -> verify models dropdown fills with `gemini-2.5-flash`, `gemini-1.5-flash`, etc.
   - Select model & target language -> click Save -> verify persistence in `chrome.storage.sync`.
2. **Main Content Translation:**
   - Test on article site (e.g. Wikipedia article, TechCrunch/Medium blog post, BBC/CNN news article).
   - Click "Перекласти сторінку" in popup -> verify main content replaces in-place while navigation, header, and footer stay in original language.
   - Click "Повернути оригінал" -> verify exact original text is restored.
3. **Article Feed / Blog List Translation:**
   - Test on a blog or news feed page with multiple cards/articles.
   - Verify all feed items are detected and translated in-place.
4. **Selection Translation:**
   - Select any paragraph or sentence -> right click -> choose "✨ Перекласти виділене (AI)" -> verify selected text is replaced in-place.
   - Click replaced text -> verify original text reverts.
