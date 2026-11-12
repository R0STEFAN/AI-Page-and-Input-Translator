export const DEFAULT_SETTINGS = {
  activeEngine: 'gemini', // 'gemini' | 'local'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  geminiAvailableModels: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  targetLanguage: 'Українська',
  localModelLoaded: false,
  localSelectedModel: 'Xenova/opus-mt-en-uk' // Default to lightweight OPUS-MT for weak PCs
};

export async function getSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS };
  }
  const storageArea = chrome.storage.sync || chrome.storage.local;
  const data = await storageArea.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}

export async function saveSettings(patch) {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return { ...DEFAULT_SETTINGS, ...patch };
  }
  const storageArea = chrome.storage.sync || chrome.storage.local;
  await storageArea.set(patch);
  return getSettings();
}
