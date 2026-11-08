// Ova funkcija se izvršava u MAIN world-u (YouTube page kontekst).
// Ima pristup: cookie-jima, ytInitialPlayerResponse, ytInitialData, ytcfg
// Koristi se iz transcript-pipeline.js via scripting.executeScript({func: fetchTranscriptInPageContext})
// Vraća: {status, segments: [{text, startSec, durSec}], debugLines}
/* exported fetchTranscriptInPageContext */

async function fetchTranscriptInPageContext(videoId) {
  const D = [];
  const controller = new AbortController();
  const startedAt = performance.now();
  function dbg(msg) { D.push(`+${Math.round(performance.now() - startedAt)}ms ${msg}`); }

  function readTranscriptFromDOM(segs) {
    const segments = [];
    segs.forEach((seg, i) => {
      const textEl = seg.querySelector('.segment-text, yt-formatted-string.segment-text, yt-formatted-string') || seg;
      const timeEl = seg.querySelector('.segment-timestamp, .segment-start-offset');
      const text = (textEl.textContent || '').trim();
      let startSec = 0;
      if (timeEl) {
        const parts = timeEl.textContent.trim().replace(/\s/g, '').split(':').map(Number);
        if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
        else if (parts.length === 3) startSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        // Fallback ako nema tajmstempa
        startSec = i * 5;
      }

      if (text && Number.isFinite(startSec) && startSec >= 0) {
        segments.push({ text, startSec, durSec: 5.0 });
      }
    });

    // Dinamički izračunaj trajanje na osnovu sledećeg segmenta
    for (let i = 0; i < segments.length - 1; i++) {
      const diff = segments[i + 1].startSec - segments[i].startSec;
      if (diff > 0) {
        segments[i].durSec = diff;
      }
    }

    return segments;
  }

  function waitForEl(sel, timeout = 5000) {
    return new Promise(resolve => {
      if (controller.signal.aborted) return resolve(null);
      const existing = document.querySelector(sel);
      if (existing) return resolve(existing);
      let timer;
      const finish = el => {
        observer.disconnect();
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        resolve(el);
      };
      const onAbort = () => finish(null);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) finish(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(null), timeout);
    });
  }

  async function waitForTranscriptPanelSegments(timeout = 2500) {
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline && !controller.signal.aborted) {
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
      for (const panel of panels) {
        const panelId = panel.getAttribute('panel-id') || panel.getAttribute('target-id') || '';
        if (!panelId.includes('transcript')) continue;

        if (panel.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
        }
        const segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
        if (segments.length > 0) return segments;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  async function readTranscriptPanel() {
    if (controller.signal.aborted) return null;
    // SPA navigation can leave the previous video's transcript in the DOM.
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      const response = typeof player?.getPlayerResponse === 'function' ? player.getPlayerResponse() : window.ytInitialPlayerResponse;
      if (response?.videoDetails?.videoId && response.videoDetails.videoId !== videoId) {
        dbg('Transcript panel: the player still shows another video, skipping');
        return null;
      }
    } catch (error) { dbg(`Transcript panel: player check failed: ${error.message}`); }
    dbg('Transcript panel: looking for the transcript on the page');

    // Provera da li su segmenti već u DOM-u (npr. otvoren sidebar)
    let transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (transcriptSegs.length > 0) {
      dbg(`Transcript panel: already open, ${transcriptSegs.length} segments`);
      return readTranscriptFromDOM(transcriptSegs);
    }

    let descriptionBtnFound = false;

    // "Show transcript" in the video description
    dbg('Transcript panel: looking for "Show transcript" in the description');
    try {
      const expandBtns = document.querySelectorAll(
        'tp-yt-paper-button#expand, #description-inline-expander tp-yt-paper-button, ' +
        '#snippet #expand, ytd-text-inline-expander #expand'
      );
      for (const btn of expandBtns) {
        if (controller.signal.aborted) return null;
        if (btn.offsetParent !== null) {
          btn.click();
          break;
        }
      }
      if (controller.signal.aborted) return null;
      const descTranscriptBtn = await waitForEl(
        'ytd-video-description-transcript-section-renderer button, ' +
        'ytd-video-description-transcript-section-renderer ytd-button-renderer, ' +
        'ytd-video-description-transcript-section-renderer #button',
        300
      );
      if (descTranscriptBtn) {
        descriptionBtnFound = true;
        dbg('Transcript panel: clicked "Show transcript" in the description');
        descTranscriptBtn.click();
        const panelSegments = await waitForTranscriptPanelSegments(3000);
        if (panelSegments?.length > 0) {
          dbg(`Transcript panel: ${panelSegments.length} segments`);
          return readTranscriptFromDOM(panelSegments);
        }
      } else {
        dbg('Transcript panel: no "Show transcript" in the description');
      }
    } catch (e) { dbg(`Transcript panel: description button error: ${e.message}`); }

    // The ⋯ menu under the video, only when the description has no transcript button
    if (controller.signal.aborted) return null;
    if (!descriptionBtnFound) {
      dbg('Transcript panel: trying the ⋯ menu under the video');
      try {
        const menuSelectors = [
          'ytd-watch-metadata ytd-menu-renderer yt-icon-button',
          'ytd-watch-metadata ytd-menu-renderer button',
          '#actions ytd-menu-renderer button',
          'ytd-video-primary-info-renderer ytd-menu-renderer button',
          'button[aria-label="More actions"]',
          'button[aria-label="Još radnji"]'
        ];
        let menuBtn = null;
        for (const sel of menuSelectors) {
          menuBtn = document.querySelector(sel);
          if (menuBtn && menuBtn.offsetParent !== null) break;
          menuBtn = null;
        }
        if (menuBtn) {
          dbg('Transcript panel: opened the ⋯ menu');
          menuBtn.click();
          await new Promise(r => setTimeout(r, 500));
          if (controller.signal.aborted) return null;

          const menuItems = document.querySelectorAll(
            'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
            'ytd-menu-popup-renderer tp-yt-paper-item, ' +
            'ytd-popup-container ytd-menu-service-item-renderer'
          );
          dbg(`Transcript panel: ${menuItems.length} items in the ⋯ menu`);

          let found = false;
          for (const item of menuItems) {
            const txt = (item.textContent || '').toLowerCase();
            if (txt.includes('transcript') || txt.includes('transkript') || txt.includes('prepis')) {
              dbg(`Transcript panel: clicked "${item.textContent.trim().substring(0, 30)}" in the ⋯ menu`);
              item.click();
              found = true;
              break;
            }
          }

          if (found) {
            const segEl = await waitForEl('ytd-transcript-segment-renderer', 2500);
            if (segEl) {
              await new Promise(r => setTimeout(r, 300));
              if (controller.signal.aborted) return null;
              transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
              dbg(`Transcript panel: ${transcriptSegs.length} segments`);
              if (transcriptSegs.length > 0) return readTranscriptFromDOM(transcriptSegs);
            } else {
              dbg('Transcript panel: no segments appeared after the ⋯ menu click');
            }
          } else {
            document.body.click();
            dbg('Transcript panel: no transcript item in the ⋯ menu');
          }
        } else {
          dbg('Transcript panel: ⋯ menu button not found');
        }
      } catch (e) { dbg(`Transcript panel: ⋯ menu error: ${e.message}`); }
    } else {
      dbg('Transcript panel: ⋯ menu skipped, the description button was found');
    }

    // A transcript panel that is already on the page
    if (controller.signal.aborted) return null;
    dbg('Transcript panel: checking panels already on the page');
    try {
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
      for (const panel of panels) {
        const panelId = panel.getAttribute('panel-id') || panel.getAttribute('target-id') || '';
        if (panelId.includes('transcript')) {
          dbg(`Transcript panel: found panel "${panelId}" (${panel.getAttribute('visibility')})`);
        }
      }
      const panelSegments = await waitForTranscriptPanelSegments(descriptionBtnFound ? 0 : 1500);
      if (panelSegments?.length > 0) {
        dbg(`Transcript panel: ${panelSegments.length} segments from an open panel`);
        return readTranscriptFromDOM(panelSegments);
      }
      dbg(`Transcript panel: none of ${panels.length} panels holds a transcript`);
    } catch (e) { dbg(`Transcript panel: panel check error: ${e.message}`); }

    return null;
  }

  function getChapters() {
    try {
      const dataVideoId = window.ytInitialData?.currentVideoEndpoint?.watchEndpoint?.videoId;
      const playerVideoId = window.ytInitialPlayerResponse?.videoDetails?.videoId;
      const overlays = (!dataVideoId || dataVideoId === videoId ? window.ytInitialData?.playerOverlays : null)
        || (!playerVideoId || playerVideoId === videoId ? window.ytInitialPlayerResponse?.playerOverlays : null);
      const markers = overlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
      if (!markers) return [];

      const macroMarkers = markers.find(m => m.key === 'MARKER_TYPE_HASHTAGS' || m.key === 'AUTO_CHAPTERS' || m.value?.chapters);
      const chapters = macroMarkers?.value?.chapters || [];

      return chapters.map(c => ({
        title: c.chapterRenderer?.title?.simpleText || c.chapterRenderer?.title?.runs?.map(run => run.text || '').join('') || '',
        timeSec: Number(c.chapterRenderer?.timeRangeStartMillis || 0) / 1000
      })).filter(c => c.title && Number.isFinite(c.timeSec) && c.timeSec >= 0);
    } catch (e) {
      dbg("Chapters err: " + e.message);
      return [];
    }
  }

  let deadlineTimer;
  try {
    const currentUrl = new URL(window.location.href);
    const currentId = currentUrl.searchParams.get('v') || currentUrl.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
    if (currentId && currentId !== videoId) {
      return { status: 'error', error: 'YouTube page navigated to a different video.', debugLines: D };
    }
    const chapters = getChapters();
    if (chapters.length > 0) dbg(`Found ${chapters.length} chapters`);

    // YouTube's transcript panel is the only source left: captionTracks timedtext needs a PO token the
    // extension cannot get (HTTP 200, empty body in every real run), and InnerTube /get_transcript answers 400.
    const deadline = new Promise(resolve => {
      deadlineTimer = setTimeout(() => { dbg('Transcript fetch timed out.'); resolve(null); }, 8000);
    });
    const segments = await Promise.race([readTranscriptPanel(), deadline]);
    controller.abort();
    if (segments?.length > 0) return { status: 'ok', segments, chapters, debugLines: [...D] };
    dbg('No transcript found on the page');

    return { status: 'error', error: 'No transcript found on the YouTube page.', debugLines: D };
  } catch (e) {
    return { status: 'error', error: e.message, debugLines: D };
  } finally {
    controller.abort();
    clearTimeout(deadlineTimer);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchTranscriptInPageContext };
}
