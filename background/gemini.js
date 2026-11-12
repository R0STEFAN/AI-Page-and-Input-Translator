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
