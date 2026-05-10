// YT Summary AI - popup.js v3.1

const PLUGIN_VERSION = "3.1";

document.addEventListener('DOMContentLoaded', async () => {
  const setupView = document.getElementById('setup-view');
  const mainView = document.getElementById('main-view');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const summarizeBtn = document.getElementById('summarize-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const debugBtn = document.getElementById('debug-btn');
  const debugArea = document.getElementById('debug-area');
  const debugLog = document.getElementById('debug-log');
  const statusDiv = document.getElementById('status');

  function log(msg) {
    const timestamp = new Date().toLocaleTimeString();
    debugLog.value += `[${timestamp}] ${msg}\n`;
    debugLog.scrollTop = debugLog.scrollHeight;
    console.log(`[YT-Summary] ${msg}`);
  }

  const data = await browser.storage.local.get('gemini_api_key');
  if (!data.gemini_api_key) showView('setup');

  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      await browser.storage.local.set({ gemini_api_key: key });
      log("API ključ sačuvan.");
      showView('main');
    }
  });

  settingsBtn.addEventListener('click', () => showView('setup'));
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

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      log(`Tab: ${tab.url}`);

      const videoId = tab.url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/)?.[1];
      if (!videoId) throw new Error("Niste na YouTube videu.");
      log(`Video ID: ${videoId}`);

      statusDiv.innerText = "SponsorBlock...";
      const sponsorSegments = await getSponsorSegments(videoId);
      log(`SponsorBlock: ${sponsorSegments.length} segmenata.`);

      statusDiv.innerText = "Dohvatanje transkripta...";
      log("Pokrećem scripting.executeScript u MAIN world-u...");

      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: fetchTranscriptInPageContext,
        args: [videoId]
      });

      const scriptResult = results[0]?.result;
      if (!scriptResult) throw new Error("executeScript nije vratio rezultat.");

      log(`Status: ${scriptResult.status}`);
      if (scriptResult.debugLines) {
        for (const line of scriptResult.debugLines) {
          log(`  [PAGE] ${line}`);
        }
      }

      if (scriptResult.status === 'error') throw new Error(scriptResult.error);

      const transcriptText = scriptResult.transcriptXml;
      log(`Transkript: ${transcriptText.length} karaktera`);

      statusDiv.innerText = "Parsiranje...";
      const segments = parseXmlTranscript(transcriptText);
      log(`Parsirano: ${segments.length} segmenata.`);
      if (segments.length === 0) throw new Error("Nema segmenata u transkriptu.");

      statusDiv.innerText = "Filtriranje...";
      const { text, savedSeconds, categoryStats } = filterSegments(segments, sponsorSegments);
      log(`Tekst: ${text.length} kar (~${Math.round(text.length / 4)} tokena). Sponsor: ${Math.round(savedSeconds)}s.`);
      if (Object.keys(categoryStats).length > 0) {
        log(`Kategorije: ${Object.entries(categoryStats).map(([k, v]) => `${k}=${Math.round(v)}s`).join(', ')}`);
      }

      statusDiv.innerText = "AI razmišlja...";
      const { gemini_api_key } = await browser.storage.local.get('gemini_api_key');
      const detail = document.getElementById('detail-level').value;
      log(`Gemini: detail=${detail}`);
      const result = await geminiSummarize(gemini_api_key, text, detail);
      log(`Gemini: ${result.text.length} kar | Tokeni: ${result.usage.promptTokens} in + ${result.usage.outputTokens} out = ${result.usage.totalTokens} total`);
      log(`Cena: ~$${result.usage.estimatedCost}`);

      const videoTitle = tab.title?.replace(' - YouTube', '') || 'Video sažetak';

      await browser.storage.session.set({ yt_transcript: text });

      await browser.storage.local.set({
        yt_summary_result: {
          summary: result.text,
          title: videoTitle,
          videoId,
          videoUrl: tab.url,
          sponsorSaved: savedSeconds,
          categoryStats,
          usage: result.usage,
          timestamp: Date.now()
        }
      });

      await browser.tabs.create({ url: browser.runtime.getURL('result.html') });

      statusDiv.innerText = "Gotovo! Sažetak otvoren u novom tabu.";
      log("=== Završeno — otvoren novi tab ===");

    } catch (error) {
      log(`GREŠKA: ${error.message}`);
      log(`Stack: ${error.stack?.substring(0, 300) || 'N/A'}`);
      statusDiv.innerText = "Greška: " + error.message;
    } finally {
      summarizeBtn.disabled = false;
    }
  }
});
