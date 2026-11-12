import { normalizeNewlines } from './gemini.js';

const OPENCODE_MODELS_URL = 'https://opencode.ai/inference/v1/models';
const OPENCODE_CHAT_URL = 'https://opencode.ai/inference/openai/v1/chat/completions';

function getOpenCodeHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey && apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

export function filterAndSortOpenCodeModels(apiData) {
  if (!apiData || !Array.isArray(apiData.data)) return [];

  const models = apiData.data
    .filter(m => m?.id)
    .map(m => m.id);

  return models.sort((a, b) => {
    // Prioritize free models first, then fast flash models
    const aFree = a.endsWith('-free');
    const bFree = b.endsWith('-free');
    if (aFree && !bFree) return -1;
    if (!aFree && bFree) return 1;

    const prio = (id) => {
      if (id.includes('nemotron-3.5-lightning')) return 1;
      if (id.includes('minimax-m3.1-flash')) return 2;
      if (id.includes('deepseek-v4.1-flash')) return 3;
      if (id.includes('claude-haiku')) return 4;
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

export function parseOpenCodeResponse(responseJson, expectedCount) {
  const rawContent = responseJson?.choices?.[0]?.message?.content;
  const contentText = Array.isArray(rawContent)
    ? rawContent.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
    : rawContent;

  if (!contentText || !String(contentText).trim()) {
    throw new Error('Порожня або некоректна відповідь від OpenCode API');
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
      throw new Error('Відповідь OpenCode не містить масиву translations');
    }
    return translations.map(t => normalizeNewlines(String(t ?? '')));
  }

  if (expectedCount === 1 && cleaned) {
    return [normalizeNewlines(cleaned)];
  }

  throw new Error('Не вдалося розібрати JSON перекладу від OpenCode API');
}

export function buildOpenCodeBatchPayload(texts, targetLanguage, model = 'nemotron-3.5-lightning-free') {
  const items = texts.map((text, id) => ({ id, text }));
  return {
    model: model || 'nemotron-3.5-lightning-free',
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: `You are a professional website translator. Translate each of the ${texts.length} items below into ${targetLanguage}.\nCRITICAL RULES:\n1. Translate each item independently according to its "id".\n2. Return ONLY strict JSON matching {"translations": ["...", "..."]} with EXACTLY ${texts.length} strings in the exact same order (id 0 to ${texts.length - 1}). Do not include explanations or markdown.\n3. NEVER merge multiple items into a single string, and NEVER split one item into multiple strings.\n4. Preserve phrasing, punctuation, numbers, formatting, line breaks, and proper nouns within each individual item.\n\nInput (${texts.length} items):\n${JSON.stringify({ items })}`
      }
    ]
  };
}

export function buildOpenCodeInputPayload(text, targetLanguage, model = 'nemotron-3.5-lightning-free') {
  return {
    model: model || 'nemotron-3.5-lightning-free',
    temperature: 0.35,
    messages: [
      {
        role: 'user',
        content: `You are an expert native-speaking assistant helping a user write online (comments, chats, emails, forms). Translate the user's draft text below into natural, idiomatic, authentic ${targetLanguage}.\nRULES:\n1. Sound like a real native speaker — avoid stiff, literal, or robotic word-for-word translation.\n2. Match the original tone (casual, polite, technical, humorous, etc.).\n3. Preserve all line breaks, markdown/code formatting, URLs, @mentions, and emojis.\n4. Return ONLY strict JSON matching {"translations": ["..."]} containing ONLY the single translated string.\n\nDraft text:\n${JSON.stringify(text)}`
      }
    ]
  };
}

export async function fetchOpenCodeModels(apiKey) {
  const res = await fetch(OPENCODE_MODELS_URL, {
    headers: getOpenCodeHeaders(apiKey)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Помилка OpenCode API (${res.status})`);
  }
  const data = await res.json();
  const models = filterAndSortOpenCodeModels(data);
  if (models.length === 0) {
    throw new Error('Не знайдено доступних моделей OpenCode');
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

async function callOpenCodeChat(payload, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Вкажіть API ключ OpenCode у налаштуваннях');
  }

  const res = await fetch(OPENCODE_CHAT_URL, {
    method: 'POST',
    headers: getOpenCodeHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const rawMsg = errData?.error?.message || errData?.message || '';
    throw new Error(rawMsg || `Помилка перекладу OpenCode (${res.status})`);
  }

  return res.json();
}

export async function translateBatchOpenCode(texts, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ OpenCode у налаштуваннях');
  if (!texts || texts.length === 0) return [];

  const payload = buildOpenCodeBatchPayload(texts, targetLanguage, model);
  const data = await callOpenCodeChat(payload, apiKey);
  const translations = parseOpenCodeResponse(data, texts.length);

  if (translations.length !== texts.length) {
    if (texts.length === 1) {
      return [translations.length > 0 ? translations.join('\n') : texts[0]];
    }
    return mapWithConcurrency(
      texts,
      3,
      item => translateSingleOpenCode(item, targetLanguage, model, apiKey)
    );
  }

  return translations;
}

export async function translateSingleOpenCode(text, targetLanguage, model, apiKey) {
  const result = await translateBatchOpenCode([text], targetLanguage, model, apiKey);
  return result[0] || text;
}

export async function translateInputOpenCode(text, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ OpenCode у налаштуваннях');
  if (!text || !text.trim()) return text;

  const payload = buildOpenCodeInputPayload(text, targetLanguage, model);
  const data = await callOpenCodeChat(payload, apiKey);
  const translations = parseOpenCodeResponse(data, 1);
  return translations.length > 0 ? translations.join('\n') : text;
}
