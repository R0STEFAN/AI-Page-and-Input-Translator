export function collectTextElements(root) {
  if (!root || !root.querySelectorAll) return [];

  const targetSelector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption';
  const targets = root.querySelectorAll(targetSelector);
  const validElements = [];

  for (const el of targets) {
    // Skip if inside code blocks, already translated, or nested in translated blocks
    if (el.closest && el.closest('pre, code, noscript, style, script, .ai-translated-block')) continue;
    if (el.dataset && el.dataset.aiOriginalHtml) continue;

    // Skip container elements that contain child target elements (avoid double-translating outer containers)
    if (el.querySelector && el.querySelector(targetSelector)) continue;

    const text = (el.innerText || '').trim();
    if (text.length < 2) continue;

    // Cache original text & HTML
    if (!el.dataset) {
      el.dataset = {};
    }
    if (!el.dataset.aiOriginalText) {
      el.dataset.aiOriginalText = el.innerText;
    }
    if (!el.dataset.aiOriginalHtml) {
      el.dataset.aiOriginalHtml = el.innerHTML || el.innerText;
    }

    validElements.push(el);
  }

  return validElements;
}
