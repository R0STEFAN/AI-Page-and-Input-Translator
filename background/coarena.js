import { normalizeNewlines } from './gemini.js';

const COARENA_MODELS_URL = 'https://coarena.ai/api/v1/models';
const COARENA_CHAT_URL = 'https://coarena.ai/api/v1/chat/completions';

function getCoarenaHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

export function filterAndSortCoarenaModels(apiData) {
  if (!apiData || !Array.isArray(apiData.data)) return [];

  const models = apiData.data
    .filter(m => m?.id && m.lifecycle !== 'deprecated')
    .map(m => m.id);

  return models.sort((a, b) => {
    // Prioritize fast, high-quality translation models
    const prio = (id) => {
      if (id.includes('claude-haiku')) return 1;
      if (id.includes('claude-sonnet')) return 2;
      if (id.includes('minimax') && id.includes('flash')) return 3;
      if (id.includes('gemini') && id.includes('flash')) return 4;
      if (id.includes('claude-opus')) return 5;
      return 10;
    };
    const diff = prio(a) - prio(b);
    if (diff !== 0) return diff;
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

export function parseCoarenaResponse(responseJson, expectedCount) {
  const rawContent = responseJson?.choices?.[0]?.message?.content;
  const contentText = Array.isArray(rawContent)
    ? rawContent.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
    : rawContent;

  if (!contentText || !String(contentText).trim()) {
    throw new Error('Порожня або некоректна відповідь від Coarena API');
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
      throw new Error('Відповідь Coarena не містить масиву translations');
    }
    return translations.map(t => normalizeNewlines(String(t ?? '')));
  }

  if (expectedCount === 1 && cleaned) {
    return [normalizeNewlines(cleaned)];
  }

  throw new Error('Не вдалося розібрати JSON перекладу від Coarena API');
}

export function buildCoarenaBatchPayload(texts, targetLanguage, model = 'claude-haiku-5-5') {
  const items = texts.map((text, id) => ({ id, text }));
  return {
    model: model || 'claude-haiku-5-5',
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: `You are a professional website translator. Translate each of the ${texts.length} items below into ${targetLanguage}.\nCRITICAL RULES:\n1. Translate each item independently according to its "id".\n2. Return ONLY strict JSON matching {"translations": ["...", "..."]} with EXACTLY ${texts.length} strings in the exact same order (id 0 to ${texts.length - 1}). Do not include explanations or markdown.\n3. NEVER merge multiple items into a single string, and NEVER split one item into multiple strings.\n4. Preserve phrasing, punctuation, numbers, formatting, line breaks, and proper nouns within each individual item.\n\nInput (${texts.length} items):\n${JSON.stringify({ items })}`
      }
    ]
  };
}

export function buildCoarenaInputPayload(text, targetLanguage, model = 'claude-haiku-5-5') {
  return {
    model: model || 'claude-haiku-5-5',
    temperature: 0.35,
    messages: [
      {
        role: 'user',
        content: `You are an expert native-speaking assistant helping a user write online (comments, chats, emails, forms). Translate the user's draft text below into natural, idiomatic, authentic ${targetLanguage}.\nRULES:\n1. Sound like a real native speaker — avoid stiff, literal, or robotic word-for-word translation.\n2. Match the original tone (casual, polite, technical, humorous, etc.).\n3. Preserve all line breaks, markdown/code formatting, URLs, @mentions, and emojis.\n4. Return ONLY strict JSON matching {"translations": ["..."]} containing ONLY the single translated string.\n\nDraft text:\n${JSON.stringify(text)}`
      }
    ]
  };
}

export async function fetchCoarenaModels(apiKey) {
  const res = await fetch(COARENA_MODELS_URL, {
    headers: getCoarenaHeaders(apiKey)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Помилка Coarena API (${res.status})`);
  }
  const data = await res.json();
  const models = filterAndSortCoarenaModels(data);
  if (models.length === 0) {
    throw new Error('Не знайдено доступних моделей Coarena');
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

async function callCoarenaChat(payload, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Вкажіть API ключ Coarena у налаштуваннях');
  }

  const res = await fetch(COARENA_CHAT_URL, {
    method: 'POST',
    headers: getCoarenaHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const rawMsg = errData?.error?.message || errData?.message || '';
    throw new Error(rawMsg || `Помилка перекладу Coarena (${res.status})`);
  }

  return res.json();
}

export async function translateBatchCoarena(texts, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ Coarena у налаштуваннях');
  if (!texts || texts.length === 0) return [];

  const payload = buildCoarenaBatchPayload(texts, targetLanguage, model);
  const data = await callCoarenaChat(payload, apiKey);
  const translations = parseCoarenaResponse(data, texts.length);

  if (translations.length !== texts.length) {
    if (texts.length === 1) {
      return [translations.length > 0 ? translations.join('\n') : texts[0]];
    }
    return mapWithConcurrency(
      texts,
      3,
      item => translateSingleCoarena(item, targetLanguage, model, apiKey)
    );
  }

  return translations;
}

export async function translateSingleCoarena(text, targetLanguage, model, apiKey) {
  const result = await translateBatchCoarena([text], targetLanguage, model, apiKey);
  return result[0] || text;
}

export async function translateInputCoarena(text, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ Coarena у налаштуваннях');
  if (!text || !text.trim()) return text;

  const payload = buildCoarenaInputPayload(text, targetLanguage, model);
  const data = await callCoarenaChat(payload, apiKey);
  const translations = parseCoarenaResponse(data, 1);
  return translations.length > 0 ? translations.join('\n') : text;
}
