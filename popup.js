// YT Summary AI - popup.js v4.0

const PLUGIN_VERSION = "4.1";

const PRESETS = {
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", model: "gemini-3-flash-preview" },
  deepseek: { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  ollama: { url: "http://localhost:11434/v1/chat/completions", model: "qwen2.5:7b" }
};

document.addEventListener('DOMContentLoaded', async () => {
  const setupView = document.getElementById('setup-view');
  const mainView = document.getElementById('main-view');

  const providerSelect = document.getElementById('llm-provider');
  const geminiModelWrapper = document.getElementById('gemini-model-wrapper');
  const geminiModelSelect = document.getElementById('gemini-model-select');
  const apiUrlInput = document.getElementById('api-url-input');
  const apiModelInput = document.getElementById('api-model-input');
  const apiKeyInput = document.getElementById('api-key-input');

  const contextWindowInput = document.getElementById('context-window-input');
  const temperatureInput = document.getElementById('temperature-input');
  const topPInput = document.getElementById('top-p-input');
  const advancedSettingsWrapper = document.getElementById('advanced-settings-wrapper');

  const saveKeyBtn = document.getElementById('save-key-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const summarizeBtn = document.getElementById('summarize-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const debugBtn = document.getElementById('debug-btn');
  const debugArea = document.getElementById('debug-area');
  const debugLog = document.getElementById('debug-log');
  const statusDiv = document.getElementById('status');

  const dashTokens = document.getElementById('dash-tokens');
  const dashCost = document.getElementById('dash-cost');
  const resetStatsBtn = document.getElementById('reset-stats-btn');

  document.getElementById('plugin-version').textContent = `v${PLUGIN_VERSION}`;

  function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    debugLog.value += `[${timestamp}] ${msg}\n`;
    debugLog.scrollTop = debugLog.scrollHeight;
    console.log(`[YT-Summary] ${msg}`);
  }

  // Load Dashboard
  async function updateDashboard() {
    const data = await browser.storage.local.get('total_usage');
    const u = data.total_usage || { tokens: 0, cost: 0 };
    dashTokens.textContent = u.tokens.toLocaleString();
    dashCost.textContent = '$' + parseFloat(u.cost).toFixed(6);
  }
  updateDashboard();

  resetStatsBtn.addEventListener('click', async () => {
    await browser.storage.local.set({ total_usage: { tokens: 0, cost: 0 } });
    updateDashboard();
    log("Statistika resetovana.");
  });

  function updateVisibility() {
    if (providerSelect.value === 'gemini') {
      geminiModelWrapper.classList.remove('hidden');
      advancedSettingsWrapper.classList.add('hidden');
    } else {
      geminiModelWrapper.classList.add('hidden');
      advancedSettingsWrapper.classList.remove('hidden');
    }
  }

  // Handle Provider Select
  providerSelect.addEventListener('change', () => {
    const p = providerSelect.value;
    if (PRESETS[p]) {
      apiUrlInput.value = PRESETS[p].url;
      if (p === 'gemini') {
        apiModelInput.value = geminiModelSelect.value;
      } else {
        apiModelInput.value = PRESETS[p].model;
      }
    }
    
    // Default values for advanced settings based on provider
    if (p === 'ollama') {
      contextWindowInput.value = 32768;
      temperatureInput.value = 0.7;
      topPInput.value = 1.0;
    } else if (p === 'deepseek') {
      contextWindowInput.value = 65536;
      temperatureInput.value = 0.7;
      topPInput.value = 1.0;
    }

    updateVisibility();
  });

  geminiModelSelect.addEventListener('change', () => {
    if (providerSelect.value === 'gemini') {
      apiModelInput.value = geminiModelSelect.value;
    }
  });

  // Load Settings
  let config = {};
  try {
    const data = await browser.storage.local.get('llm_config');
    config = data.llm_config || {};
  } catch(e) {
    log("Greska pri ucitavanju: " + e.message);
  }

  // Migration for old config
  if (config && config.provider === 'gemini-lite') {
    config.provider = 'gemini';
    config.model = 'gemini-3.1-flash-lite';
    await browser.storage.local.set({ llm_config: config });
  }

  // Initialize UI with config
  providerSelect.value = config.provider || 'gemini';
  apiUrlInput.value = config.url || PRESETS[providerSelect.value]?.url || PRESETS.gemini.url;
  apiKeyInput.value = config.apiKey || '';
  contextWindowInput.value = config.contextWindow || 32768;
  temperatureInput.value = config.temperature || 0.7;
  topPInput.value = config.topP || 1.0;

  if (providerSelect.value === 'gemini') {
    const savedModel = config.model || geminiModelSelect.value;
    const optionExists = Array.from(geminiModelSelect.options).some(opt => opt.value === savedModel);
    if (optionExists) {
      geminiModelSelect.value = savedModel;
    }
    apiModelInput.value = geminiModelSelect.value;
  } else {
    apiModelInput.value = config.model || PRESETS[providerSelect.value]?.model || '';
  }

  if (!config || (!config.apiKey && config.provider !== 'ollama')) {
    showView('setup');
  }
  updateVisibility();

  saveKeyBtn.addEventListener('click', async () => {
    const newConfig = {
      provider: providerSelect.value,
      url: apiUrlInput.value.trim(),
      model: apiModelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      contextWindow: parseInt(contextWindowInput.value) || 32768,
      temperature: parseFloat(temperatureInput.value) || 0.7,
      topP: parseFloat(topPInput.value) || 1.0
    };
    if (newConfig.url && newConfig.model) {
      await browser.storage.local.set({ llm_config: newConfig });
      log("Podešavanja sačuvana.");
      showView('main');
    } else {
      alert("URL i Model su obavezni.");
    }
  });

  cancelBtn.addEventListener('click', () => {
    showView('main');
  });

  settingsBtn.addEventListener('click', () => {
    updateDashboard();
    showView('setup');
  });

  debugBtn.addEventListener('click', () => debugArea.classList.toggle('hidden'));
  summarizeBtn.addEventListener('click', startAnalysis);

  function showView(view) {
    if (view === 'setup') {
      setupView.classList.remove('hidden');
      mainView.classList.add('hidden');
    } else {
      setupView.classList.add('hidden');
      mainView.classList.remove('hidden');
    }
  }

  async function startAnalysis() {
    log(`=== Nova Analiza | v${PLUGIN_VERSION} | ${navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || '?'} ===`);
    statusDiv.innerText = "Inicijalizacija...";
    summarizeBtn.disabled = true;

    let heartbeatInterval;

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      log(`Tab: ${tab.url}`);

      const videoId = tab.url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/)?.[1];
      if (!videoId) throw new Error("Niste na YouTube videu.");
      log(`Video ID: ${videoId}`);

      // Transcript pipeline: dohvatanje, parsiranje, SponsorBlock filtriranje
      statusDiv.innerText = "Dohvatanje i obrada transkripta...";
      const transcript = await getProcessedTranscript(tab.id, videoId);

      for (const line of transcript.debugLines) {
        log(`  [PAGE] ${line}`);
      }
      log(`Transkript: ${transcript.segmentCount} segmenata. SponsorBlock: ${transcript.sponsorCount} (${Math.round(transcript.savedSeconds)}s filtrirano).`);
      if (Object.keys(transcript.categoryStats).length > 0) {
        log(`Kategorije: ${Object.entries(transcript.categoryStats).map(([k, v]) => `${k}=${Math.round(v)}s`).join(', ')}`);
      }
      log(`Tekst: ${transcript.text.length} kar (~${Math.round(transcript.text.length / 4)} tokena).`);

      // LLM sumarizacija
      statusDiv.innerText = "AI razmišlja...";
      const { llm_config } = await browser.storage.local.get('llm_config');
      if (!llm_config) throw new Error("LLM nije konfigurisan.");

      const detail = document.getElementById('detail-level').value;
      const persona = document.getElementById('persona-level').value;
      log(`LLM: provider=${llm_config.provider}, model=${llm_config.model}, detail=${detail}, persona=${persona}`);
      if (transcript.chapters && transcript.chapters.length > 0) {
        log(`Poglavlja: ${transcript.chapters.length} pronađeno.`);
      }

      const onProgress = (msg) => {
        statusDiv.innerText = msg;
        log(`[PROGRES] ${msg}`);
      };

      const result = await llmSummarizeLong(llm_config, transcript.text, detail, persona, transcript.chapters, onProgress);
      log(`Odgovor: ${result.text.length} kar | Tokeni: ${result.usage.promptTokens} in + ${result.usage.outputTokens} out = ${result.usage.totalTokens} total`);
      log(`Cena: ~$${result.usage.estimatedCost}`);

      const videoTitle = tab.title?.replace(' - YouTube', '') || 'Video sažetak';

      await browser.storage.session.set({ yt_transcript: transcript.text });

      const finalResult = {
        summary: result.text,
        title: videoTitle,
        videoId,
        videoUrl: tab.url,
        sponsorSaved: transcript.savedSeconds,
        categoryStats: transcript.categoryStats,
        chapters: transcript.chapters,
        usage: result.usage,
        timestamp: Date.now()
      };

      await browser.storage.local.set({ yt_summary_result: finalResult });
      await browser.tabs.create({ url: browser.runtime.getURL('result.html') });

      statusDiv.innerText = "Gotovo! Sažetak otvoren u novom tabu.";
      log("=== Završeno — otvoren novi tab ===");

    } catch (error) {
      log(`GREŠKA: ${error.message}`);
      log(`Stack: ${error.stack?.substring(0, 300) || 'N/A'}`);
      statusDiv.innerText = "Greška: " + error.message;
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      summarizeBtn.disabled = false;
    }
  }
});