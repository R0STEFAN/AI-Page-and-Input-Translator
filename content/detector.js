export function calculateDensityScore(textLength, tagCount, paragraphCount) {
  if (textLength < 100 || paragraphCount < 1) return 0;
  return (textLength / Math.max(tagCount, 1)) * Math.sqrt(paragraphCount);
}

export function findMainContent(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return null;

  // Step 1: Explicit semantic tags
  // Do not select a single <article> if the page has 3 or more articles (feed/list page)
  const articleCount = doc.querySelectorAll ? doc.querySelectorAll('article').length : 0;
  const semanticSelector = articleCount >= 3 ? 'main, [role="main"]' : 'main, [role="main"], article';
  const semanticMain = doc.querySelector ? doc.querySelector(semanticSelector) : null;
  if (semanticMain && (semanticMain.innerText || '').trim().length > 300) {
    return semanticMain;
  }

  // Step 2: Feed / Article list detection
  const feedSelector = 'article, .post, .card, .feed-item, .article-item';
  const feedItems = doc.querySelectorAll ? doc.querySelectorAll(feedSelector) : [];
  if (feedItems && feedItems.length >= 3) {
    let parent = feedItems[0].parentElement;
    while (parent && parent !== doc.body) {
      const containedCount = parent.querySelectorAll ? parent.querySelectorAll(feedSelector).length : 0;
      if (containedCount >= feedItems.length) {
        return parent;
      }
      if (containedCount >= 3) {
        // Traverse up if an ancestor contains more feed items up to doc.body
        if (parent.parentElement && parent.parentElement !== doc.body) {
          const parentCount = parent.parentElement.querySelectorAll ? parent.parentElement.querySelectorAll(feedSelector).length : 0;
          if (parentCount > containedCount) {
            parent = parent.parentElement;
            continue;
          }
        }
        return parent;
      }
      parent = parent.parentElement;
    }
    if (parent && parent !== doc.body) return parent;
  }

  // Step 3: Density heuristic fallback
  const candidates = doc.querySelectorAll ? doc.querySelectorAll('div, section') : [];
  const blacklist = new Set(['HEADER', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'SCRIPT', 'STYLE']);

  let bestElement = doc.body;
  let bestScore = 0;

  for (const el of candidates) {
    if (blacklist.has(el.tagName)) continue;
    if (el.closest && el.closest('header, nav, footer, aside, .sidebar, .menu, .comments')) continue;

    const text = (el.innerText || '').trim();
    const tagCount = el.getElementsByTagName ? el.getElementsByTagName('*').length : 0;
    const pCount = el.querySelectorAll ? el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').length : 0;

    const score = calculateDensityScore(text.length, tagCount, pCount);
    if (score > bestScore) {
      bestScore = score;
      bestElement = el;
    }
  }

  return bestElement;
}
