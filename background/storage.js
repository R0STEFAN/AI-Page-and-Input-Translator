export const DEFAULT_SETTINGS = {
  activeEngine: 'gemini', // 'gemini' | 'coarena' | 'openrouter' | 'local'
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  geminiAvailableModels: ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.8-flash'],
  coarenaApiKey: '',
  coarenaModel: 'claude-haiku-5-5',
  coarenaAvailableModels: [
    'claude-haiku-5-5',
    'claude-sonnet-5-5',
    'minimax-m3-1-flash',
    'gemini-3-8-flash',
    'claude-opus-5-5'
  ],
  openrouterApiKey: '',
  openrouterModel: 'openrouter/free',
  openrouterAvailableModels: [
    'openrouter/free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-super-vl:free'
  ],
  targetLanguage: 'Українська',
  inputTargetLanguage: 'English',
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
