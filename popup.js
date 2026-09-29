// YT Summary AI - popup.js
const PLUGIN_VERSION = (typeof browser !== 'undefined' && browser.runtime?.getManifest)
  ? browser.runtime.getManifest().version
  : "4.4";

const PRESETS = LLM_PROVIDERS;

async function initializePopup() {
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

  const uiLanguageSelect = document.querySelector('#ui-language');
  const outputLanguageSelect = document.querySelector('#output-language');

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
    dashTokens.textContent = (Number(u.tokens) || 0).toLocaleString();
    dashCost.textContent = '$' + (Number(u.cost) || 0).toFixed(6);
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
      apiModelInput.readOnly = true;
    } else {
      geminiModelWrapper.classList.add('hidden');
      advancedSettingsWrapper.classList.remove('hidden');
      apiModelInput.readOnly = false;
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
        apiModelInput.value = PRESETS[p].defaultModel;
      }
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

  // Migrate legacy Gemini Lite and replace removed providers with safe defaults.
  const normalizedConfig = normalizeLlmConfig(config);
  if (JSON.stringify(normalizedConfig) !== JSON.stringify(config)) {
    config = normalizedConfig;
    await browser.storage.local.set({ llm_config: config });
  }

  // Initialize UI with config
  providerSelect.value = config.provider || 'gemini';
  apiUrlInput.value = PRESETS[providerSelect.value].url;
  apiKeyInput.value = config.apiKey || '';
  contextWindowInput.value = config.contextWindow || 32768;
  temperatureInput.value = config.temperature ?? 0.7;
  topPInput.value = config.topP ?? 1.0;

  uiLanguageSelect.value = config.uiLanguage || 'en';
  outputLanguageSelect.value = config.outputLanguage || 'English';

  let customPrompts = [];
  try {
    const data = await browser.storage.local.get('custom_templates');
    customPrompts = data.custom_templates || [];
  } catch(e) { log("Custom templates load failed: " + e.message); }

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
      const span = document.createElement('span');
      span.textContent = p.name;
      const delBtn = document.createElement('button');
      delBtn.className = 'secondary';
      delBtn.style.cssText = 'padding:2px 5px; font-size:9px; margin:0;';
      delBtn.dataset.idx = idx;
      delBtn.textContent = 'X';
      div.appendChild(span);
      div.appendChild(delBtn);
      delBtn.addEventListener('click', async () => {
        customPrompts.splice(idx, 1);
        await browser.storage.local.set({ custom_templates: customPrompts });
        renderCustomPrompts();
      });
      list.appendChild(div);

      const opt = document.createElement('option');
      opt.value = 'custom_' + idx;
      opt.textContent = `${getLocalizedString('custom_prefix', config.uiLanguage || 'en')}: ${p.name}`;
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
    renderCustomPrompts();
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
    apiModelInput.value = config.model || PRESETS[providerSelect.value].defaultModel;
  }

  if (!config.apiKey) {
    showView('setup');
  }
  updateVisibility();

  saveKeyBtn.addEventListener('click', async () => {
    const newConfig = normalizeLlmConfig({
      provider: providerSelect.value,
      url: PRESETS[providerSelect.value].url,
      model: apiModelInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      contextWindow: parseInt(contextWindowInput.value) || 32768,
      temperature: Number.isFinite(parseFloat(temperatureInput.value)) ? parseFloat(temperatureInput.value) : 0.7,
      topP: Number.isFinite(parseFloat(topPInput.value)) ? parseFloat(topPInput.value) : 1.0,
      uiLanguage: uiLanguageSelect.value,
      outputLanguage: outputLanguageSelect.value
    });
    if (newConfig.apiKey && newConfig.model) {
      await browser.storage.local.set({ llm_config: newConfig });
      config = newConfig; // update local ref
      log("Podešavanja sačuvana.");
      showView('main');
    } else {
      alert(getLocalizedString('settings_required', config.uiLanguage || 'en'));
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (!config.apiKey) return;
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
    if (tab && tab.url) {
      try {
        const urlObj = new URL(tab.url);
        if ((urlObj.hostname === 'youtube.com' || urlObj.hostname.endsWith('.youtube.com')) && urlObj.searchParams.has('list')) {
          document.getElementById('playlist-summarize-btn').classList.remove('hidden');
        }
      } catch(e) { console.warn("Playlist URL parse error:", e.message); }
    }
  }).catch(error => log(`Playlist detection failed: ${error.message}`));

  const playlistSummarizeBtn = document.getElementById('playlist-summarize-btn');
  if (playlistSummarizeBtn) {
    playlistSummarizeBtn.addEventListener('click', async () => {
      if (playlistSummarizeBtn.disabled) return;
      log("Inicijalizacija batch procesiranja...");
      playlistSummarizeBtn.disabled = true;
      try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab || !config.apiKey) throw new Error(getLocalizedString('settings_required', config.uiLanguage || 'en'));
      
      const [{ result: videoIds }] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          const ids = new Set();
          try {
            // 1. Ako smo na /playlist?list=... stranici
            const browsePlaylist = window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
            if (browsePlaylist) {
              for (const item of browsePlaylist) {
                if (item.playlistVideoRenderer?.videoId) {
                  ids.add(item.playlistVideoRenderer.videoId);
                }
              }
            }
            // 2. Ako smo na /watch?v=...&list=... stranici sa panelom sa strane
            const watchPlaylist = window.ytInitialData?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents;
            if (watchPlaylist) {
              for (const item of watchPlaylist) {
                if (item.playlistPanelVideoRenderer?.videoId) {
                  ids.add(item.playlistPanelVideoRenderer.videoId);
                }
              }
            }
            // 3. Fallback preko DOM a (provera za oba tipa linkova)
            document.querySelectorAll('a.ytd-playlist-panel-video-renderer, a.ytd-playlist-video-renderer, ytd-playlist-video-renderer a#video-title, ytd-playlist-panel-video-renderer a#wc-endpoint').forEach(a => {
              const href = a.getAttribute('href') || a.search || '';
              const v = new URLSearchParams(href.includes('?') ? href.split('?')[1] : href).get('v');
              if (v) ids.add(v);
            });
            // 4. Bar trenutni video iz URL-a ako ništa drugo ne upali
            const v = new URLSearchParams(window.location.search).get('v');
            if (v && ids.size === 0) ids.add(v);
          } catch (e) { console.warn("Error scraping playlist IDs:", e); }
          return Array.from(ids);
        }
      });

      if (!videoIds || videoIds.length === 0) {
        alert(getLocalizedString('playlist_empty', config.uiLanguage || 'en'));
        playlistSummarizeBtn.disabled = false;
        return;
      }

      log(`Pronađeno ${videoIds.length} videa u playlisti.`);

      const detail = document.getElementById('detail-level').value;
      const persona = resolvePersona(document.getElementById('persona-level').value, customPrompts);
      const outputLang = config.outputLanguage || 'English';

      // Sačuvaj trenutne logove pre otvaranja playlist.html
      await browser.storage.local.set({ yt_debug_logs: debugLog.value });

      const jobId = crypto.randomUUID();
      await browser.storage.session.set({
        [`yt_batch_${jobId}`]: {
          videoIds,
          llmConfig: config,
          detail,
          persona,
          outputLang,
          timestamp: Date.now()
        }
      });

      await browser.tabs.create({ url: browser.runtime.getURL(`playlist.html?id=${jobId}`) });
      window.close();
      } catch (error) {
        log(`Playlist error: ${error.message}`);
        statusDiv.textContent = getLocalizedString('status_error', config.uiLanguage || 'en') + error.message;
      } finally {
        playlistSummarizeBtn.disabled = false;
      }
    });
  }

  async function startAnalysis() {
    if (summarizeBtn.disabled) return;
    log(`=== New Analysis | v${PLUGIN_VERSION} | ${navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || '?'} ===`);
    statusDiv.textContent = typeof getLocalizedString === 'function' ? getLocalizedString('status_init', config.uiLanguage || 'en') : "Initializing...";
    summarizeBtn.disabled = true;


    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      const videoId = getYoutubeVideoId(tab?.url);
      if (!videoId) throw new Error(getLocalizedString('not_youtube', config.uiLanguage || 'en'));
      log(`Tab: ${tab.url}`);
      log(`Video ID: ${videoId}`);

      // Transcript pipeline: dohvatanje, parsiranje, SponsorBlock filtriranje
      statusDiv.textContent = typeof getLocalizedString === 'function' ? getLocalizedString('status_fetching', config.uiLanguage || 'en') : "Fetching transcript...";
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
      statusDiv.textContent = typeof getLocalizedString === 'function' ? getLocalizedString('status_thinking', config.uiLanguage || 'en') : "AI is thinking...";
      const { llm_config } = await browser.storage.local.get('llm_config');
      if (!llm_config) throw new Error("LLM nije konfigurisan.");

      const detail = document.getElementById('detail-level').value;
      const persona = resolvePersona(document.getElementById('persona-level').value, customPrompts);
      const outputLang = llm_config.outputLanguage || 'English';
      
      log(`LLM: provider=${llm_config.provider}, model=${llm_config.model}, detail=${detail}, persona=${Object.prototype.hasOwnProperty.call(PERSONA_PROMPTS, persona) ? persona : 'custom'}, outputLang=${outputLang}`);
      if (transcript.chapters && transcript.chapters.length > 0) {
        log(`Chapters: ${transcript.chapters.length} found.`);
      }

      const onProgress = (msg) => {
        statusDiv.textContent = msg;
        log(`[PROGRES] ${msg}`);
      };

      const result = await llmSummarizeLong(llm_config, transcript.text, detail, persona, transcript.chapters, outputLang, onProgress);
      log(`Response: ${result.text.length} chars | Tokens: ${result.usage.promptTokens} in + ${result.usage.outputTokens} out = ${result.usage.totalTokens} total`);
      log(`Cost: ~$${result.usage.estimatedCost}`);

      const videoTitle = tab.title?.replace(' - YouTube', '') || 'Video sažetak';

      const resultId = crypto.randomUUID();
      const finalResult = {
        id: resultId,
        summary: result.text,
        title: videoTitle,
        videoId,
        videoUrl: tab.url,
        sponsorSaved: transcript.savedSeconds,
        categoryStats: transcript.categoryStats,
        chapters: transcript.chapters,
        usage: result.usage,
        model: llm_config.model,
        detail,
        persona,
        outputLang,
        timestamp: Date.now()
      };

      await browser.storage.session.set({
        [`yt_result_${resultId}`]: { result: finalResult, transcript: transcript.text }
      });
      await browser.storage.local.set({ yt_summary_result: finalResult });
      await browser.storage.local.set({ yt_debug_logs: debugLog.value });
      await browser.tabs.create({ url: browser.runtime.getURL(`result.html?id=${resultId}`) });

      statusDiv.textContent = getLocalizedString('status_done', config.uiLanguage || 'en');
      log("=== Finished — opened new tab ===");

    } catch (error) {
      log(`ERROR: ${error.message}`);
      if (error.debugLines && error.debugLines.length > 0) {
        for (const line of error.debugLines) {
          log(`  [PAGE] ${line}`);
        }
      }
      log(`Stack: ${error.stack?.substring(0, 300) || 'N/A'}`);
      statusDiv.textContent = getLocalizedString('status_error', config.uiLanguage || 'en') + error.message;
      await browser.storage.local.set({ yt_debug_logs: debugLog.value });
    } finally {
      summarizeBtn.disabled = false;
    }
  }
}

function getYoutubeVideoId(urlString) {
  try {
    const url = new URL(urlString);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname;
    let videoId;
    if (host === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      videoId = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    }
    return /^[0-9A-Za-z_-]{11}$/.test(videoId || '') ? videoId : null;
  } catch { return null; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializePopup, getYoutubeVideoId };
} else {
  document.addEventListener('DOMContentLoaded', initializePopup);
}
