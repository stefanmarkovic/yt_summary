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

  function parseCaptions(text) {
    // 1. Probaj kao JSON
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data?.events)) {
        const segments = [];
        for (const event of data.events) {
          if (!Array.isArray(event?.segs)) continue;
          const startSec = Number(event.tStartMs || 0) / 1000;
          const durSec = Math.max(0, Number(event.dDurationMs || 0) / 1000);
          if (!Number.isFinite(startSec) || startSec < 0 || !Number.isFinite(durSec)) continue;
          const utf8Text = event.segs.map(s => typeof s?.utf8 === 'string' ? s.utf8 : '').join('').trim();
          if (utf8Text) {
            segments.push({ text: utf8Text, startSec, durSec });
          }
        }
        return segments;
      }
    } catch (e) {
      // Nije JSON, nastavi na XML
    }

    // XML parser supports both legacy <text> captions and timed-text <p> captions.
    const segments = [];
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) return [];
    for (const node of xml.querySelectorAll('text, p')) {
      const scale = node.tagName === 'p' ? 1000 : 1;
      const startSec = Number(node.getAttribute(scale === 1000 ? 't' : 'start') || 0) / scale;
      const durSec = Math.max(0, Number(node.getAttribute(scale === 1000 ? 'd' : 'dur') || 0) / scale);
      let caption = (node.textContent || '').trim();
      // Legacy timedtext double-escapes entities (`&amp;#39;`), so one XML pass leaves `&#39;`.
      if (caption.includes('&')) {
        caption = new DOMParser().parseFromString(caption, 'text/html').documentElement.textContent.trim();
      }
      if (caption && Number.isFinite(startSec) && startSec >= 0 && Number.isFinite(durSec)) {
        segments.push({ text: caption, startSec, durSec });
      }
    }
    return segments;
  }

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

  // ======= Strategija 1: baseUrl iz ytInitialPlayerResponse =======
  async function tryBaseUrl(signal) {
    dbg("M1: ytInitialPlayerResponse baseUrl");
    let pr = null;
    try {
      const moviePlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
        const tempPr = moviePlayer.getPlayerResponse();
        if (tempPr?.videoDetails?.videoId === videoId) {
          pr = tempPr;
          dbg("M1: found correct playerResponse from movie_player");
        } else if (tempPr?.videoDetails?.videoId) {
          dbg(`M1: movie_player stale (${tempPr.videoDetails.videoId} != ${videoId})`);
        }
      }
    } catch (e) { dbg(`M1 movie_player err: ${e.message}`); }

    if (!pr && window.ytInitialPlayerResponse) {
      const responseVideoId = window.ytInitialPlayerResponse.videoDetails?.videoId;
      if (responseVideoId && responseVideoId !== videoId) {
        dbg(`M1: stale data (${responseVideoId} != ${videoId}), skipping`);
      } else {
        pr = window.ytInitialPlayerResponse;
      }
    }

    if (!pr) return null;

    const captionTracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks?.length) return null;

    const track = captionTracks.find(t => t.languageCode === 'sr') ||
                  captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
                  captionTracks.find(t => t.languageCode === 'en') ||
                  captionTracks[0];
    dbg(`M1: track=${track.languageCode}(${track.kind || 'manual'})`);

    const url = track.baseUrl;
    try {
      const resp = await fetch(url, { credentials: 'include', signal });
      const txt = await resp.text();
      dbg(`M1: HTTP ${resp.status} CT=${resp.headers.get('content-type')||'?'} len=${txt.length}`);
      if (resp.ok && txt.trim()) {
        const segments = parseCaptions(txt);
        dbg(`M1: ${segments.length} segments parsed`);
        if (segments.length > 0) return segments;
      }
    } catch (e) { dbg(`M1 err: ${e.message}`); }
    return null;
  }

  // ======= Strategija 2: DOM Scraping =======
  async function tryDomScraping() {
    if (controller.signal.aborted) return null;
    // SPA navigation can leave the previous video's transcript in the DOM.
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      const response = typeof player?.getPlayerResponse === 'function' ? player.getPlayerResponse() : window.ytInitialPlayerResponse;
      if (response?.videoDetails?.videoId && response.videoDetails.videoId !== videoId) {
        dbg('M2: stale player, ignoring transcript DOM');
        return null;
      }
    } catch (error) { dbg(`M2 player check: ${error.message}`); }
    dbg("M2: DOM scraping");

    // Provera da li su segmenti već u DOM-u (npr. otvoren sidebar)
    let transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (transcriptSegs.length > 0) {
      dbg(`M2: found ${transcriptSegs.length} segments already present in DOM`);
      return readTranscriptFromDOM(transcriptSegs);
    }

    let descriptionBtnFound = false;

    // Strategija A: Transcript dugme u opisu videa
    dbg("M2-A: transcript button in description");
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
        dbg("M2-A: click on transcript button in description");
        descTranscriptBtn.click();
        const panelSegments = await waitForTranscriptPanelSegments(3000);
        if (panelSegments?.length > 0) {
          dbg(`M2-A: found ${panelSegments.length} segments`);
          return readTranscriptFromDOM(panelSegments);
        }
      } else {
        dbg("M2-A: no transcript button in description");
      }
    } catch (e) { dbg(`M2-A err: ${e.message}`); }

    // Strategija B: Tri-tačke meni → "Show transcript" (samo ako opis dugme nije nađeno)
    if (controller.signal.aborted) return null;
    if (!descriptionBtnFound) {
      dbg("M2-B: three-dot menu");
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
          dbg("M2-B: click on menu button");
          menuBtn.click();
          await new Promise(r => setTimeout(r, 500));
          if (controller.signal.aborted) return null;

          const menuItems = document.querySelectorAll(
            'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
            'ytd-menu-popup-renderer tp-yt-paper-item, ' +
            'ytd-popup-container ytd-menu-service-item-renderer'
          );
          dbg(`M2-B: ${menuItems.length} items in menu`);

          let found = false;
          for (const item of menuItems) {
            const txt = (item.textContent || '').toLowerCase();
            if (txt.includes('transcript') || txt.includes('transkript') || txt.includes('prepis')) {
              dbg(`M2-B: click on "${item.textContent.trim().substring(0, 30)}"`);
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
              dbg(`M2-B: ${transcriptSegs.length} segments`);
              if (transcriptSegs.length > 0) return readTranscriptFromDOM(transcriptSegs);
            } else {
              dbg("M2-B: segments did not appear");
            }
          } else {
            document.body.click();
            dbg("M2-B: transcript option not found");
          }
        } else {
          dbg("M2-B: menu button not found");
        }
      } catch (e) { dbg(`M2-B err: ${e.message}`); }
    } else {
      dbg("M2-B skipped: description button was found");
    }

    // Strategija C: Direktno proveri engagement panel
    if (controller.signal.aborted) return null;
    dbg("M2-C: engagement panel check");
    try {
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
      for (const panel of panels) {
        const panelId = panel.getAttribute('panel-id') || panel.getAttribute('target-id') || '';
        if (panelId.includes('transcript')) {
          dbg(`M2-C: panel id="${panelId}" visibility=${panel.getAttribute('visibility')}`);
        }
      }
      const panelSegments = await waitForTranscriptPanelSegments(descriptionBtnFound ? 0 : 1500);
      if (panelSegments?.length > 0) {
        dbg(`M2-C: ${panelSegments.length} segments from panel`);
        return readTranscriptFromDOM(panelSegments);
      }
      dbg(`M2-C: ${panels.length} panels, none with transcript`);
    } catch (e) { dbg(`M2-C err: ${e.message}`); }

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

  // ======= Glavni fallback loop =======
  let deadlineTimer;
  let domTimer;
  try {
    const currentUrl = new URL(window.location.href);
    const currentId = currentUrl.searchParams.get('v') || currentUrl.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
    if (currentId && currentId !== videoId) {
      return { status: 'error', error: 'YouTube page navigated to a different video.', debugLines: D };
    }
    const chapters = getChapters();
    if (chapters.length > 0) dbg(`Found ${chapters.length} chapters`);

    // Captions and DOM scraping race; the loser is aborted so it stops using the network and the page.
    // InnerTube /get_transcript was removed: since late 2026 it answers 400 "Precondition check failed".
    // DOM scraping clicks the page, so it waits 150ms for captions, or less once captions come back empty.
    const captionAttempt = tryBaseUrl(controller.signal);
    const domAttempt = new Promise(resolve => {
      domTimer = setTimeout(resolve, 150);
      captionAttempt.then(segments => { if (!segments?.length) resolve(); }, resolve);
    }).then(() => (controller.signal.aborted ? null : tryDomScraping()));
    const attempts = [captionAttempt, domAttempt];
    const successfulAttempts = attempts.map((attempt, index) => attempt.then(segments => {
      if (segments && segments.length > 0) return { index, segments };
      if (!controller.signal.aborted) dbg(`M${index + 1}: finished without segments`);
      throw new Error(`M${index + 1} returned no segments`);
    }));

    try {
      const deadline = new Promise((_resolve, reject) => {
        deadlineTimer = setTimeout(() => reject(new Error('Transcript fetch timed out.')), 8000);
      });
      const winner = await Promise.race([Promise.any(successfulAttempts), deadline]);
      controller.abort();
      dbg(`Transcript winner: M${winner.index + 1}`);
      return { status: 'ok', segments: winner.segments, chapters, debugLines: [...D] };
    } catch (error) {
      dbg(error instanceof AggregateError ? 'All transcript strategies returned no segments.' : error.message);
      controller.abort();
    }

    return { status: 'error', error: 'All methods failed.', debugLines: D };
  } catch (e) {
    return { status: 'error', error: e.message, debugLines: D };
  } finally {
    controller.abort();
    clearTimeout(deadlineTimer);
    clearTimeout(domTimer);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchTranscriptInPageContext };
}
