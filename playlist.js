document.addEventListener('DOMContentLoaded', async () => {
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

  async function getSponsorSegments(videoId) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["sponsor","selfpromo","interaction","intro","outro"]`, {
        signal: controller.signal
      });
      clearTimeout(id);
      return resp.ok ? await resp.json() : [];
    } catch { return []; }
  }

  async function getTranscriptDirectly(videoId) {
    await logToDebug(`[DIRECT] Pokrećem getTranscriptDirectly za video ${videoId}...`);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) {
      await logToDebug(`[DIRECT] GREŠKA: Učitavanje watch stranice nije uspelo, HTTP ${resp.status}`);
      throw new Error(`Watch page load failed with HTTP ${resp.status}`);
    }
    const html = await resp.text();
    await logToDebug(`[DIRECT] Watch stranica preuzeta. Dužina HTML-a: ${html.length} karaktera.`);

    // 1. Izdvajanje API ključa
    let apiKey = '';
    const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) 
      || html.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
    if (keyMatch) {
      apiKey = keyMatch[1];
    } else {
      apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    }
    await logToDebug(`[DIRECT] API Key: ${apiKey.substring(0, 10)}...`);

    // 2. Izdvajanje clientVersion
    let clientVersion = '2.20260518.01.00';
    const versionMatch = html.match(/"clientVersion"\s*:\s*"([^"]+)"/) 
      || html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
    if (versionMatch) {
      clientVersion = versionMatch[1];
    }
    await logToDebug(`[DIRECT] Client Version: ${clientVersion}`);

    // 3. Izdvajanje ytInitialData
    const dataMatch = html.match(/ytInitialData\s*=\s*/)
      || html.match(/window\["ytInitialData"\]\s*=\s*/);
    if (!dataMatch) {
      await logToDebug(`[DIRECT] GREŠKA: ytInitialData nije pronađen u HTML-u.`);
      throw new Error("ytInitialData not found in HTML");
    }
    
    const startIndex = dataMatch.index + dataMatch[0].length;
    let dataStr = html.substring(startIndex);
    const endMatch = dataStr.match(/};/) || dataStr.match(/}<\/script>/);
    if (endMatch) {
      dataStr = dataStr.substring(0, endMatch.index + 1);
    }
    
    let ytData;
    try {
      ytData = JSON.parse(dataStr);
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

    const postResp = await fetch(postUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ context, params: transcriptParams })
    });

    await logToDebug(`[DIRECT] InnerTube HTTP status: ${postResp.status}`);
    if (!postResp.ok) {
      const errTxt = await postResp.text();
      await logToDebug(`[DIRECT] GREŠKA: InnerTube poziv nije uspeo: ${errTxt.substring(0, 150)}`);
      throw new Error(`InnerTube API failed with HTTP ${postResp.status}`);
    }

    const data = await postResp.json();
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
      title = titleMatch[1].replace(" - YouTube", "");
    }

    return { segments, trackInfo: { languageCode: 'en', kind: 'innertube' }, title };
  }

  const storage = await browser.storage.local.get('batch_job');
  if (!storage.batch_job) {
    document.getElementById('progress-text').textContent = 'No batch job found.';
    await logToDebug("Nije pronađen batch posao u skladištu.");
    return;
  }

  const { batch_job } = storage;
  const total = batch_job.videoIds.length;
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('batch-progress');
  const resultsContainer = document.getElementById('batch-results');

  await logToDebug(`Započinjem batch procesiranje za ${total} videa.`);

  for (let i = 0; i < total; i++) {
    const videoId = batch_job.videoIds[i];
    const statusMsg = `Processing video ${i+1} of ${total}... (ID: ${videoId})`;
    progressText.textContent = statusMsg;
    progressBar.value = (i / total) * 100;
    await logToDebug(statusMsg);

    let tab;
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
          if (win && win.id) {
            try {
              await browser.windows.remove(win.id);
              await logToDebug(`Zatvoren pozadinski prozor (ID: ${win.id}).`);
            } catch (e) {
              await logToDebug(`Greška pri zatvaranju prozora: ${e.message}`);
            }
          }
        }
      }

      // Ako je direktan fetch uspeo, moramo sami da filtriramo SponsorBlock segmente
      if (segments) {

        for (const seg of sponsorSegments) {
          const cat = seg.category || 'unknown';
          const duration = (seg.segment?.[1] || 0) - (seg.segment?.[0] || 0);
          categoryStats[cat] = (categoryStats[cat] || 0) + duration;
        }
        
        const skipRanges = sponsorSegments.map(s => s.segment);
        const filtered = segments.filter(seg => {
          const segEnd = seg.startSec + seg.durSec;
          const isSkipped = skipRanges.some(([s, e]) => seg.startSec < e && segEnd > s);
          if (isSkipped) { savedSeconds += seg.durSec; return false; }
          return true;
        });

        transcriptText = filtered.map(s => {
          const min = Math.floor(s.startSec / 60);
          const sec = Math.floor(s.startSec % 60).toString().padStart(2, '0');
          return `[${min}:${sec}] ${s.text}`;
        }).join(' ');
      }
      
      const sumMsg = `Summarizing video ${i+1}...`;
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
      errH3.textContent = `Video ${i+1} Error`;
      const errP = document.createElement('p');
      errP.textContent = err.message;
      div.appendChild(errH3);
      div.appendChild(errP);
      resultsContainer.appendChild(div);
      console.error(`Batch video ${videoId} error:`, err);
    } finally {
      if (tab) {
        await logToDebug(`Zatvaram pozadinski tab za ${videoId}.`);
        await browser.tabs.remove(tab.id);
      }
    }
  }

  progressBar.value = 100;
  const finishMsg = `Finished processing ${total} videos.`;
  progressText.textContent = finishMsg;
  await logToDebug(finishMsg);
  await browser.storage.local.remove('batch_job');
});