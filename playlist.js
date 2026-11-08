async function initializePlaylist() {
  if (typeof localizePage === 'function') {
    const data = await browser.storage.local.get('llm_config');
    localizePage(data.llm_config?.uiLanguage || 'en');
  }

  // Učitaj perzistentne logove iz skladišta na početku
  const debugData = await browser.storage.local.get('yt_debug_logs');
  const debugContainer = document.getElementById('debug-section');
  const debugTextArea = document.getElementById('result-debug-log');
  if (debugData.yt_debug_logs && debugContainer && debugTextArea) {
    debugTextArea.value = debugData.yt_debug_logs;
    debugContainer.style.display = 'block';
  }

  async function logToDebug(msg) {
    if (debugContainer && debugTextArea) {
      const timestamp = new Date().toLocaleTimeString();
      debugTextArea.value += `[${timestamp}] [PLAYLIST] ${msg}\n`;
      debugTextArea.scrollTop = debugTextArea.scrollHeight;
      debugContainer.style.display = 'block';
      await browser.storage.local.set({ yt_debug_logs: debugTextArea.value });
    }
    console.log(`[PLAYLIST] ${msg}`);
  }

  const jobId = new URLSearchParams(window.location.search).get('id');
  const jobKey = jobId ? `yt_batch_${jobId}` : null;
  const storage = jobKey ? await browser.storage.session.get(jobKey) : {};
  const batch_job = jobKey ? storage[jobKey] : null;
  if (!batch_job || !Array.isArray(batch_job.videoIds) || !batch_job.llmConfig?.apiKey) {
    document.getElementById('progress-text').textContent = getLocalizedString('batch_missing', document.documentElement.lang);
    await logToDebug("Nije pronađen batch posao u skladištu.");
    return;
  }

  localizePage(batch_job.llmConfig.uiLanguage || 'en');
  const localize = key => getLocalizedString(key, batch_job.llmConfig.uiLanguage || 'en');
  const total = batch_job.videoIds.length;
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('batch-progress');
  const resultsContainer = document.getElementById('batch-results');

  await logToDebug(`Započinjem batch procesiranje za ${total} videa.`);

  for (let i = 0; i < total; i++) {
    const videoId = batch_job.videoIds[i];
    const statusMsg = localize('batch_processing').replace('{current}', i + 1).replace('{total}', total);
    progressText.textContent = statusMsg;
    progressBar.value = (i / total) * 100;
    await logToDebug(statusMsg);

    let transcriptText = "";
    let savedSeconds = 0;
    let categoryStats = {};
    let chapters = [];
    let videoTitle = `Video ${i + 1}`;

    const videoStartedAt = Date.now();
    const seconds = ms => `${(ms / 1000).toFixed(1)}s`;
    try {
      let win = null;
      let transcriptMs = 0;
      try {
        win = await browser.windows.create({
          url: `https://www.youtube.com/watch?v=${videoId}`,
          focused: false,
          type: "popup",
          width: 100,
          height: 100,
          left: -2000,
          top: -2000
        });
        await logToDebug(`Pozadinski prozor kreiran (ID: ${win.id}). Čekam 6 sekundi da se učita...`);
        await new Promise(r => setTimeout(r, 6000));

        const tabs = await browser.tabs.query({ windowId: win.id });
        if (!tabs || tabs.length === 0) {
          throw new Error("Neuspešno pronalaženje taba u pozadinskom prozoru.");
        }
        const tabId = tabs[0].id;

        const transcriptStartedAt = Date.now();
        const processed = await getProcessedTranscript(tabId, videoId);
        transcriptMs = Date.now() - transcriptStartedAt;
        transcriptText = processed.text;
        savedSeconds = processed.savedSeconds;
        categoryStats = processed.categoryStats;
        chapters = processed.chapters;

        const tabDetails = await browser.tabs.get(tabId);
        if (tabDetails.title) {
          videoTitle = tabDetails.title.replace(/^\(\d+\+?\)\s*/, '').replace(/ - YouTube$/, '');
        }

        for (const line of processed.debugLines) {
          await logToDebug(`  [PAGE] ${line}`);
        }
      } finally {
        if (win?.id !== undefined) {
          try {
            await browser.windows.remove(win.id);
            await logToDebug(`Zatvoren pozadinski prozor (ID: ${win.id}).`);
          } catch (e) {
            await logToDebug(`Greška pri zatvaranju prozora: ${e.message}`);
          }
        }
      }
      if (!transcriptText) throw new Error('No usable transcript content.');

      const sumMsg = localize('batch_summarizing').replace('{current}', i + 1);
      progressText.textContent = sumMsg;
      await logToDebug(sumMsg);

      const llmStartedAt = Date.now();
      const result = await llmSummarizeLong(
        batch_job.llmConfig,
        transcriptText,
        batch_job.detail,
        batch_job.persona,
        chapters,
        batch_job.outputLang
      );
      await logToDebug(`Sažetak za video ${i+1} završen. Karakteri: ${result.text.length}.`);
      for (const call of result.calls || []) await logToDebug(`[LLM] ${describeLlmCall(call)}`);
      await logToDebug(`[TIMING] video ${i + 1}: window wait 6.0s (fixed) | transcript ${seconds(transcriptMs)} | LLM ${seconds(Date.now() - llmStartedAt)} | total ${seconds(Date.now() - videoStartedAt)}`);

      const div = document.createElement('div');
      div.className = 'summary info-card';
      div.style.display = 'block';
      div.style.marginBottom = '20px';
      
      // Video header
      const header = document.createElement('div');
      header.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 15px;';
      const h2 = document.createElement('h2');
      h2.style.margin = '0';
      const link = document.createElement('a');
      link.href = `https://youtu.be/${videoId}`;
      link.target = '_blank';
      link.style.cssText = 'color: #818cf8; text-decoration: none;';
      link.textContent = videoTitle;
      h2.appendChild(link);
      header.appendChild(h2);
      div.appendChild(header);

      // Delegate rendering to shared summary-renderer.js
      const contentDiv = document.createElement('div');
      div.appendChild(contentDiv);
      renderSummaryCard(contentDiv, {
        summary: result.text,
        title: videoTitle,
        videoId,
        videoUrl: `https://youtu.be/${videoId}`,
        sponsorSaved: savedSeconds,
        categoryStats: categoryStats,
        usage: result.usage
      }, batch_job.llmConfig);

      resultsContainer.appendChild(div);

    } catch (err) {
      await logToDebug(`GREŠKA na videu ${i+1} (${videoId}): ${err.message}`);
      if (err.debugLines && err.debugLines.length > 0) {
        for (const line of err.debugLines) {
          await logToDebug(`  [PAGE] ${line}`);
        }
      }
      const div = document.createElement('div');
      div.className = 'summary info-card';
      div.style.display = 'block';
      div.style.marginBottom = '20px';
      const errH3 = document.createElement('h3');
      errH3.style.color = '#ef4444';
      errH3.textContent = `${localize('status_error')}Video ${i + 1}`;
      const errP = document.createElement('p');
      errP.textContent = err.message;
      div.appendChild(errH3);
      div.appendChild(errP);
      resultsContainer.appendChild(div);
      console.error(`Batch video ${videoId} error:`, err);
    }
  }

  progressBar.value = 100;
  const finishMsg = localize('batch_finished').replace('{total}', total);
  progressText.textContent = finishMsg;
  await logToDebug(finishMsg);
  await browser.storage.session.remove(jobKey);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initializePlaylist };
} else {
  document.addEventListener('DOMContentLoaded', initializePlaylist);
}
