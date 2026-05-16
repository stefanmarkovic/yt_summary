// YT Summary AI - popup.js v4.0
window.onerror = function(message, source, lineno, colno, error) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'color:red;font-size:10px;background:#fee;padding:5px;margin:5px;border:1px solid red;';
  errDiv.textContent = `ERROR: ${message} at ${lineno}:${colno}`;
  document.body.appendChild(errDiv);
};
window.onunhandledrejection = function(event) {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'color:red;font-size:10px;background:#fee;padding:5px;margin:5px;border:1px solid red;';
  errDiv.textContent = `PROMISE REJECTION: ${event.reason}`;
  document.body.appendChild(errDiv);
};

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

  const uiLanguageSelect = document.getElementById('ui-language');
  const outputLanguageSelect = document.getElementById('output-language');

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
    log("Error loading config: " + e.message);
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

  uiLanguageSelect.value = config.uiLanguage || 'en';
  outputLanguageSelect.value = config.outputLanguage || 'English';

  let customPrompts = [];
  try {
    const data = await browser.storage.local.get('custom_templates');
    customPrompts = data.custom_templates || [];
  } catch(e) {}

  function renderCustomPrompts() {
    const list = document.getElementById('custom-prompts-list');
    list.replaceChildren();
    const personaSelect = document.getElementById('persona-level');
    // Keep only standard options
    Array.from(personaSelect.options).forEach(opt => {
      if (opt.value.startsWith('custom_')) opt.remove();
    });

    customPrompts.forEach((p, idx) => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.innerHTML = `<span>${p.name}</span><button class="secondary" style="padding:2px 5px; font-size:9px; margin:0;" data-idx="${idx}">X</button>`;
      div.querySelector('button').addEventListener('click', async (e) => {
        const i = e.target.dataset.idx;
        customPrompts.splice(i, 1);
        await browser.storage.local.set({ custom_templates: customPrompts });
        renderCustomPrompts();
      });
      list.appendChild(div);

      const opt = document.createElement('option');
      opt.value = 'custom_' + idx;
      opt.textContent = `Custom: ${p.name}`;
      personaSelect.appendChild(opt);
    });
  }
  renderCustomPrompts();

  document.getElementById('add-custom-prompt-btn').addEventListener('click', async () => {
    const name = document.getElementById('custom-prompt-name').value.trim();
    const text = document.getElementById('custom-prompt-text').value.trim();
    if (name && text) {
      customPrompts.push({ name, text });
      await browser.storage.local.set({ custom_templates: customPrompts });
      document.getElementById('custom-prompt-name').value = '';
      document.getElementById('custom-prompt-text').value = '';
      renderCustomPrompts();
    }
  });

  if (typeof localizePage === 'function') {
    localizePage(uiLanguageSelect.value);
  }

  uiLanguageSelect.addEventListener('change', async () => {
    config.uiLanguage = uiLanguageSelect.value;
    await browser.storage.local.set({ llm_config: config });
    if (typeof localizePage === 'function') {
      localizePage(config.uiLanguage);
    }
  });

  outputLanguageSelect.addEventListener('change', async () => {
    config.outputLanguage = outputLanguageSelect.value;
    await browser.storage.local.set({ llm_config: config });
  });

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
      topP: parseFloat(topPInput.value) || 1.0,
      uiLanguage: uiLanguageSelect.value,
      outputLanguage: outputLanguageSelect.value
    };
    if (newConfig.url && newConfig.model) {
      await browser.storage.local.set({ llm_config: newConfig });
      config = newConfig; // update local ref
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

  // Playlist detection
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('youtube.com')) {
      try {
        const urlObj = new URL(tab.url);
        if (urlObj.searchParams.has('list')) {
          document.getElementById('playlist-summarize-btn').classList.remove('hidden');
        }
      } catch(e) {}
    }
  });

  const playlistSummarizeBtn = document.getElementById('playlist-summarize-btn');
  if (playlistSummarizeBtn) {
    playlistSummarizeBtn.addEventListener('click', async () => {
      log("Inicijalizacija batch procesiranja...");
      playlistSummarizeBtn.disabled = true;
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      const [{ result: videoIds }] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const ids = new Set();
          try {
            const panels = window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
            if (panels) {
              for (const item of panels) {
                if (item.playlistVideoRenderer?.videoId) {
                  ids.add(item.playlistVideoRenderer.videoId);
                }
              }
            }
            document.querySelectorAll('a.ytd-playlist-panel-video-renderer, a.ytd-playlist-video-renderer').forEach(a => {
              const v = new URLSearchParams(a.search).get('v');
              if (v) ids.add(v);
            });
            // Try url params
            const v = new URLSearchParams(window.location.search).get('v');
            if (v && ids.size === 0) ids.add(v); // At least the current one
          } catch (e) {}
          return Array.from(ids);
        }
      });

      if (!videoIds || videoIds.length === 0) {
        alert("No videos found in playlist.");
        playlistSummarizeBtn.disabled = false;
        return;
      }

      log(`Pronađeno ${videoIds.length} videa u playlisti.`);

      const detail = document.getElementById('detail-level').value;
      const personaVal = document.getElementById('persona-level').value;
      let persona = personaVal;
      if (personaVal.startsWith('custom_')) {
        const idx = parseInt(personaVal.replace('custom_', ''));
        if (customPrompts[idx]) persona = 'CUSTOM:' + customPrompts[idx].text;
      }
      const outputLang = config.outputLanguage || 'English';

      await browser.storage.local.set({
        batch_job: {
          videoIds,
          llmConfig: config,
          detail,
          persona,
          outputLang,
          timestamp: Date.now()
        }
      });

      await browser.tabs.create({ url: browser.runtime.getURL('playlist.html') });
      window.close();
    });
  }

  async function startAnalysis() {
    log(`=== New Analysis | v${PLUGIN_VERSION} | ${navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || '?'} ===`);
    statusDiv.innerText = typeof getLocalizedString === 'function' ? getLocalizedString('status_init', config.uiLanguage || 'en') : "Initializing...";
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
      statusDiv.innerText = typeof getLocalizedString === 'function' ? getLocalizedString('status_fetching', config.uiLanguage || 'en') : "Fetching transcript...";
      const transcript = await getProcessedTranscript(tab.id, videoId);

      for (const line of transcript.debugLines) {
        log(`  [PAGE] ${line}`);
      }
      log(`Transcript: ${transcript.segmentCount} segments. SponsorBlock: ${transcript.sponsorCount} (${Math.round(transcript.savedSeconds)}s filtered).`);
      if (Object.keys(transcript.categoryStats).length > 0) {
        log(`Categories: ${Object.entries(transcript.categoryStats).map(([k, v]) => `${k}=${Math.round(v)}s`).join(', ')}`);
      }
      log(`Text: ${transcript.text.length} chars (~${Math.round(transcript.text.length / 4)} tokens).`);

      // LLM sumarizacija
      statusDiv.innerText = typeof getLocalizedString === 'function' ? getLocalizedString('status_thinking', config.uiLanguage || 'en') : "AI is thinking...";
      const { llm_config } = await browser.storage.local.get('llm_config');
      if (!llm_config) throw new Error("LLM nije konfigurisan.");

      const detail = document.getElementById('detail-level').value;
      const personaVal = document.getElementById('persona-level').value;
      let persona = personaVal;
      if (personaVal.startsWith('custom_')) {
        const idx = parseInt(personaVal.replace('custom_', ''));
        if (customPrompts[idx]) {
          persona = 'CUSTOM:' + customPrompts[idx].text;
        }
      }
      const outputLang = llm_config.outputLanguage || 'English';
      
      log(`LLM: provider=${llm_config.provider}, model=${llm_config.model}, detail=${detail}, persona=${persona.startsWith('CUSTOM:') ? 'custom' : persona}, outputLang=${outputLang}`);
      if (transcript.chapters && transcript.chapters.length > 0) {
        log(`Chapters: ${transcript.chapters.length} found.`);
      }

      const onProgress = (msg) => {
        statusDiv.innerText = msg;
        log(`[PROGRES] ${msg}`);
      };

      const result = await llmSummarizeLong(llm_config, transcript.text, detail, persona, transcript.chapters, outputLang, onProgress);
      log(`Response: ${result.text.length} chars | Tokens: ${result.usage.promptTokens} in + ${result.usage.outputTokens} out = ${result.usage.totalTokens} total`);
      log(`Cost: ~$${result.usage.estimatedCost}`);

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
      log("=== Finished — opened new tab ===");

    } catch (error) {
      log(`ERROR: ${error.message}`);
      log(`Stack: ${error.stack?.substring(0, 300) || 'N/A'}`);
      statusDiv.innerText = "Greška: " + error.message;
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      summarizeBtn.disabled = false;
    }
  }
});