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

  async function getTranscriptDirectly(videoId) {
    await logToDebug(`[DIRECT] Pokrećem getTranscriptDirectly za video ${videoId}...`);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await fetchPlaylistResponse(url, { credentials: 'include' }, 'text');
    await logToDebug(`[DIRECT] Watch stranica preuzeta. Dužina HTML-a: ${html.length} karaktera.`);

    // 1. Izdvajanje API ključa
    const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) 
      || html.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
    if (!keyMatch) throw new Error('YouTube API key not found; using page fallback.');
    const apiKey = keyMatch[1];

    // 2. Izdvajanje clientVersion
    const versionMatch = html.match(/"clientVersion"\s*:\s*"([^"]+)"/) 
      || html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
    if (!versionMatch) throw new Error('YouTube client version not found; using page fallback.');
    const clientVersion = versionMatch[1];
    await logToDebug(`[DIRECT] Client Version: ${clientVersion}`);

    // 3. Izdvajanje ytInitialData
    const dataMatch = html.match(/ytInitialData\s*=\s*/)
      || html.match(/window\["ytInitialData"\]\s*=\s*/);
    if (!dataMatch) {
      await logToDebug(`[DIRECT] GREŠKA: ytInitialData nije pronađen u HTML-u.`);
      throw new Error("ytInitialData not found in HTML");
    }
    
    let ytData;
    try {
      ytData = parsePlaylistInitialData(html, dataMatch.index + dataMatch[0].length);
    } catch (e) {
      await logToDebug(`[DIRECT] GREŠKA: Neuspešno parsiranje ytInitialData JSON-a.`);
      throw new Error("Failed to parse ytInitialData");
    }

    // 4. Izdvajanje transcriptParams
    let transcriptParams = null;
    if (ytData.engagementPanels) {
      for (const panel of ytData.engagementPanels) {
        const r = panel.engagementPanelSectionListRenderer;
        if (r?.panelIdentifier === 'engagement-panel-searchable-transcript') {
          const endpoint = r.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint;
          if (endpoint?.params) {
            transcriptParams = decodeURIComponent(endpoint.params);
          }
          break;
        }
      }
    }

    if (!transcriptParams) {
      await logToDebug(`[DIRECT] GREŠKA: transcriptParams nije pronađen (video verovatno nema titlove).`);
      throw new Error("No caption tracks or transcriptParams in playerResponse");
    }
    await logToDebug(`[DIRECT] Params pronađeni: ${transcriptParams.substring(0, 15)}...`);

    // 5. POST poziv InnerTube API-ju
    const postUrl = `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`;
    const context = {
      client: {
        clientName: "WEB",
        clientVersion: clientVersion,
        hl: "en",
        gl: "US",
        utcOffsetMinutes: -new Date().getTimezoneOffset()
      }
    };

    const data = await fetchPlaylistResponse(postUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ context, params: transcriptParams })
    }, 'json');
    const segments = [];
    for (const action of (data.actions || [])) {
      const panel = action.updateEngagementPanelAction?.content?.transcriptRenderer
        || action.updateEngagementPanelAction?.content;
      const body = panel?.body?.transcriptBodyRenderer
        || panel?.transcriptRenderer?.body?.transcriptBodyRenderer;
      if (body?.initialSegments) {
        for (const seg of body.initialSegments) {
          const sr = seg.transcriptSegmentRenderer;
          if (sr) {
            const text = (sr.snippet?.runs || []).map(r => r.text).join('');
            const startMs = parseInt(sr.startMs || '0', 10);
            const endMs = parseInt(sr.endMs || '0', 10);
            if (text.trim()) {
              segments.push({ text, startSec: startMs / 1000, durSec: (endMs - startMs) / 1000 });
            }
          }
        }
      }
    }

    await logToDebug(`[DIRECT] Parsirano ${segments.length} segmenata iz InnerTube-a.`);
    if (segments.length === 0) {
      throw new Error("Direktno parsiranje iz InnerTube-a vratilo je 0 segmenata.");
    }

    // Dobijanje naslova videa iz HTML-a
    let title = `Video ${videoId}`;
    const titleMatch = html.match(/<meta\s+name="title"\s+content="([^"]+)"/)
      || html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const titleElement = new DOMParser().parseFromString(`<textarea>${titleMatch[1]}</textarea>`, 'text/html');
      title = titleElement.querySelector('textarea').textContent.replace(/ - YouTube$/, '');
    }

    return { segments, trackInfo: { languageCode: 'en', kind: 'innertube' }, title };
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

    try {
      let segments = null;
      let sponsorSegments = [];

      try {
        await logToDebug(`Pokušavam direktan fetch (bez taba) za video ${videoId}...`);
        const [sbData, directData] = await Promise.all([
          getSponsorSegments(videoId),
          getTranscriptDirectly(videoId)
        ]);
        sponsorSegments = sbData;
        segments = directData.segments;
        if (directData.title) {
          videoTitle = directData.title;
        }
        await logToDebug(`Direktan fetch uspeo! Video: "${videoTitle}" [Jezik: ${directData.trackInfo.languageCode}(${directData.trackInfo.kind || 'manual'})].`);
      } catch (directErr) {
        await logToDebug(`Direktan fetch nije uspeo: ${directErr.message}. Pokrećem prozor fallback...`);
        
        let win = null;
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

          const processed = await getProcessedTranscript(tabId, videoId);
          // Pošto je getProcessedTranscript već odradio SponsorBlock, preuzimamo gotove podatke
          transcriptText = processed.text;
          savedSeconds = processed.savedSeconds;
          categoryStats = processed.categoryStats;
          chapters = processed.chapters;
          
          // Dohvati najsvežiji naslov taba nakon učitavanja
          const tabDetails = await browser.tabs.get(tabId);
          if (tabDetails.title) {
            videoTitle = tabDetails.title.replace(' - YouTube', '');
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
      }

      if (segments) {
        const processed = processTranscriptSegments(segments, sponsorSegments);
        transcriptText = processed.text;
        savedSeconds = processed.savedSeconds;
        categoryStats = processed.categoryStats;
      }
      if (!transcriptText) throw new Error('No usable transcript content.');

      const sumMsg = localize('batch_summarizing').replace('{current}', i + 1);
      progressText.textContent = sumMsg;
      await logToDebug(sumMsg);
      
      const result = await llmSummarizeLong(
        batch_job.llmConfig, 
        transcriptText, 
        batch_job.detail, 
        batch_job.persona, 
        chapters, 
        batch_job.outputLang
      );
      await logToDebug(`Sažetak za video ${i+1} završen. Karakteri: ${result.text.length}.`);
      
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
  module.exports = { initializePlaylist, parsePlaylistInitialData, fetchPlaylistResponse };
} else {
  document.addEventListener('DOMContentLoaded', initializePlaylist);
}

// Scan a balanced JSON object rather than splitting at a delimiter inside a title.
function parsePlaylistInitialData(html, startIndex) {
  const start = html.indexOf('{', startIndex);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length && start !== -1; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(html.slice(start, index + 1));
  }
  throw new Error('Incomplete ytInitialData JSON');
}

async function fetchPlaylistResponse(url, options, format, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`YouTube request failed with HTTP ${response.status}`);
    return await response[format]();
  } finally {
    clearTimeout(timer);
  }
}
