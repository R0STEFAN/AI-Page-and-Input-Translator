import { normalizeNewlines } from './gemini.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getOpenRouterHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Title': 'AI Page Translator'
  };
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    headers['HTTP-Referer'] = chrome.runtime.getURL('');
  } else {
    headers['HTTP-Referer'] = 'https://ai-page-translator.local';
  }
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

export function isFreeOpenRouterModel(model) {
  if (!model?.id) return false;
  const outModalities = model.architecture?.output_modalities;
  if (Array.isArray(outModalities)) {
    if (!outModalities.includes('text') || outModalities.includes('audio')) {
      return false;
    }
  }
  if (model.id === 'openrouter/free' || model.id.endsWith(':free')) {
    return true;
  }
  if (model.pricing) {
    const promptCost = Number(model.pricing.prompt);
    const completionCost = Number(model.pricing.completion);
    const hasPaidCost = Object.values(model.pricing).some(v => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    });
    if (!hasPaidCost && Number.isFinite(promptCost) && Number.isFinite(completionCost) && promptCost === 0 && completionCost === 0) {
      return true;
    }
  }
  return false;
}

export function filterAndSortFreeModels(apiData) {
  if (!apiData || !Array.isArray(apiData.data)) return [];

  const uniqueIds = Array.from(new Set(
    apiData.data
      .filter(isFreeOpenRouterModel)
      .map(m => m.id)
  ));

  return uniqueIds.sort((a, b) => {
    if (a === 'openrouter/free') return -1;
    if (b === 'openrouter/free') return 1;
    const aFreeSuffix = a.endsWith(':free');
    const bFreeSuffix = b.endsWith(':free');
    if (aFreeSuffix && !bFreeSuffix) return -1;
    if (!aFreeSuffix && bFreeSuffix) return 1;
    return a.localeCompare(b);
  });
}

function stripReasoningAndFences(rawText) {
  return String(rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function parseOpenRouterResponse(responseJson, expectedCount) {
  const rawContent = responseJson?.choices?.[0]?.message?.content;
  const contentText = Array.isArray(rawContent)
    ? rawContent.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
    : rawContent;

  if (!contentText || !String(contentText).trim()) {
    throw new Error('Порожня або некоректна відповідь від OpenRouter API');
  }

  const cleaned = stripReasoningAndFences(contentText);

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try {
        parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
      } catch {}
    }
    if (!parsed) {
      const arrStart = cleaned.indexOf('[');
      const arrEnd = cleaned.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        try {
          parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
        } catch {}
      }
    }
  }

  if (parsed !== null) {
    const translations = Array.isArray(parsed) ? parsed : parsed.translations;
    if (!Array.isArray(translations)) {
      throw new Error('Відповідь OpenRouter не містить масиву translations');
    }
    return translations.map(t => normalizeNewlines(String(t ?? '')));
  }

  // Some free models occasionally reply with plain translated text for a 1-item prompt
  if (expectedCount === 1 && cleaned) {
    return [normalizeNewlines(cleaned)];
  }

  throw new Error('Не вдалося розібрати JSON перекладу від OpenRouter API');
}

// Models that mandate reasoning and reject reasoning: { enabled: false }
const REASONING_MANDATORY_MODELS = new Set([
  'baidu/ernie-5.5-flash-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'liquid/lfm-3-1.7b:free',
  'recursive/flint-v1.0:free'
]);

function attachReasoningConfig(payload, model) {
  if (!model) return payload;
  if (REASONING_MANDATORY_MODELS.has(model)) {
    // Leave reasoning config unset so provider does not throw 400
    return payload;
  }
  // For openrouter/free, nemotron, dots, etc., disable reasoning tokens to make responses instant (300-600ms)
  payload.reasoning = { enabled: false };
  return payload;
}

export function buildOpenRouterBatchPayload(texts, targetLanguage, model = 'openrouter/free') {
  const items = texts.map((text, id) => ({ id, text }));
  const payload = {
    model: model || 'openrouter/free',
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: `You are a professional website translator. Translate each of the ${texts.length} items below into ${targetLanguage}.\nCRITICAL RULES:\n1. Translate each item independently according to its "id".\n2. Return ONLY valid JSON matching {"translations": ["...", "..."]} with EXACTLY ${texts.length} strings in the exact same order (id 0 to ${texts.length - 1}). Do not include markdown or explanations.\n3. NEVER merge multiple items into a single string, and NEVER split one item into multiple strings.\n4. Preserve phrasing, punctuation, numbers, formatting, line breaks, and proper nouns within each individual item.\n\nInput (${texts.length} items):\n${JSON.stringify({ items })}`
      }
    ]
  };
  return attachReasoningConfig(payload, model);
}

export function buildOpenRouterInputPayload(text, targetLanguage, model = 'openrouter/free') {
  const payload = {
    model: model || 'openrouter/free',
    temperature: 0.35,
    messages: [
      {
        role: 'user',
        content: `You are an expert native-speaking assistant helping a user write online (comments, chats, emails, forms). Translate the user's draft text below into natural, idiomatic, authentic ${targetLanguage}.\nRULES:\n1. Sound like a real native speaker — avoid stiff, literal, or robotic word-for-word translation.\n2. Match the original tone (casual, polite, technical, humorous, etc.).\n3. Preserve all line breaks, markdown/code formatting, URLs, @mentions, and emojis.\n4. Return ONLY valid JSON matching {"translations": ["..."]} containing ONLY the single translated string.\n\nDraft text:\n${JSON.stringify(text)}`
      }
    ]
  };
  return attachReasoningConfig(payload, model);
}

export async function fetchOpenRouterModels(apiKey) {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: getOpenRouterHeaders(apiKey)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Помилка OpenRouter API (${res.status})`);
  }
  const data = await res.json();
  const models = filterAndSortFreeModels(data);
  if (models.length === 0) {
    throw new Error('Не знайдено безкоштовних (:free) текстових моделей OpenRouter');
  }
  return models;
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function callOpenRouterChat(payload, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Вкажіть API ключ OpenRouter у налаштуваннях');
  }

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const rawMsg = errData?.error?.message || errData?.message || '';
    const upstream = errData?.error?.metadata?.raw || '';
    const fullMsg = upstream ? `${rawMsg}: ${upstream}` : rawMsg;
    throw new Error(fullMsg || `Помилка перекладу OpenRouter (${res.status})`);
  }

  return res.json();
}

export async function translateBatchOpenRouter(texts, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ OpenRouter у налаштуваннях');
  if (!texts || texts.length === 0) return [];

  const payload = buildOpenRouterBatchPayload(texts, targetLanguage, model);
  const data = await callOpenRouterChat(payload, apiKey);
  const translations = parseOpenRouterResponse(data, texts.length);

  if (translations.length !== texts.length) {
    if (texts.length === 1) {
      return [translations.length > 0 ? translations.join('\n') : texts[0]];
    }
    return mapWithConcurrency(
      texts,
      3,
      item => translateSingleOpenRouter(item, targetLanguage, model, apiKey)
    );
  }

  return translations;
}

export async function translateSingleOpenRouter(text, targetLanguage, model, apiKey) {
  const result = await translateBatchOpenRouter([text], targetLanguage, model, apiKey);
  return result[0] || text;
}

export async function translateInputOpenRouter(text, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ OpenRouter у налаштуваннях');
  if (!text || !text.trim()) return text;

  const payload = buildOpenRouterInputPayload(text, targetLanguage, model);
  const data = await callOpenRouterChat(payload, apiKey);
  const translations = parseOpenRouterResponse(data, 1);
  return translations.length > 0 ? translations.join('\n') : text;
}
