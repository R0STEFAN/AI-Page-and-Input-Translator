export function filterAndSortModels(apiData) {
  if (!apiData || !Array.isArray(apiData.models)) return [];

  const models = apiData.models
    .filter(m => {
      const methods = m.supportedGenerationMethods || [];
      return m?.name && methods.includes('generateContent') && !m.name?.includes('embedding');
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

export function normalizeNewlines(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t');
}

export function buildBatchTranslationPayload(texts, targetLanguage) {
  const items = texts.map((text, id) => ({ id, text }));
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are a professional website translator. Translate each of the ${texts.length} items below into ${targetLanguage}.\nCRITICAL RULES:\n1. Translate each item independently according to its "id".\n2. Return strict JSON matching {"translations": ["...", "..."]} with EXACTLY ${texts.length} strings in the exact same order (id 0 to ${texts.length - 1}).\n3. NEVER merge multiple items into a single string, and NEVER split one item into multiple strings.\n4. Preserve phrasing, punctuation, numbers, formatting, line breaks, and proper nouns within each individual item.\n\nInput (${texts.length} items):\n${JSON.stringify({ items })}`
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

  return translations.map(t => normalizeNewlines(t));
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
  const translations = parseGeminiResponse(data, texts.length);

  if (translations.length !== texts.length) {
    if (texts.length === 1) {
      return [translations.length > 0 ? translations.join('\n') : texts[0]];
    }
    return Promise.all(
      texts.map(item => translateSingleGemini(item, targetLanguage, model, apiKey))
    );
  }

  return translations;
}

export async function translateSingleGemini(text, targetLanguage, model, apiKey) {
  const result = await translateBatchGemini([text], targetLanguage, model, apiKey);
  return result[0] || text;
}

export function buildInputTranslationPayload(text, targetLanguage) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You are an expert native-speaking assistant helping a user write online (comments, chats, emails, forms). Translate the user's draft text below into natural, idiomatic, authentic ${targetLanguage}.
RULES:
1. Sound like a real native speaker — avoid stiff, literal, or robotic word-for-word translation.
2. Match the original tone (casual, polite, technical, humorous, etc.).
3. Preserve all line breaks, markdown/code formatting, URLs, @mentions, and emojis.
4. Return strict JSON matching {"translations": ["..."]} containing ONLY the single translated string.

Draft text:
${JSON.stringify(text)}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.35,
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

export async function translateInputGemini(text, targetLanguage, model, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('Вкажіть API ключ Gemini у налаштуваннях');
  if (!text || !text.trim()) return text;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const payload = buildInputTranslationPayload(text, targetLanguage);

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
  const translations = parseGeminiResponse(data, 1);
  return translations.length > 0 ? translations.join('\n') : text;
}
