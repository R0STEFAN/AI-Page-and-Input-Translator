export function collectTextElements(root) {
  if (!root || !root.querySelectorAll) return [];

  const targets = root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption');
  const validElements = [];

  for (const el of targets) {
    // Skip if inside code blocks or already translated
    if (el.closest && el.closest('pre, code, noscript, style, script')) continue;
    const text = (el.innerText || '').trim();
    if (text.length < 2) continue;

    // Cache original text
    if (!el.dataset) {
      el.dataset = {};
    }
    if (!el.dataset.aiOriginalText) {
      el.dataset.aiOriginalText = el.innerText;
    }

    validElements.push(el);
  }

  return validElements;
}
