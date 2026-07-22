// Ova funkcija se izvršava u MAIN world-u (YouTube page kontekst).
// Ima pristup: cookie-jima, ytInitialPlayerResponse, ytInitialData, ytcfg
// Koristi se iz transcript-pipeline.js via scripting.executeScript({func: fetchTranscriptInPageContext})
// Vraća: {status, segments: [{text, startSec, durSec}], debugLines}
/* exported fetchTranscriptInPageContext */

async function fetchTranscriptInPageContext(videoId) {
  const D = [];
  function dbg(msg) { D.push(msg); }

  function stripHtmlTags(input) {
    let previous;
    do {
      previous = input;
      input = input.replace(/<[^>]*>/g, '');
    } while (input !== previous);
    return input.replace(/<|>/g, '');
  }

  function parseCaptions(text) {
    // 1. Probaj kao JSON
    try {
      const data = JSON.parse(text);
      if (data.events) {
        const segments = [];
        for (const event of data.events) {
          if (!event.segs) continue;
          const startSec = (event.tStartMs || 0) / 1000;
          const durSec = (event.dDurationMs || 0) / 1000;
          const utf8Text = event.segs.map(s => s.utf8).join('').trim();
          if (utf8Text) {
            segments.push({ text: utf8Text, startSec, durSec });
          }
        }
        return segments;
      }
    } catch (e) {
      // Nije JSON, nastavi na XML
    }

    // 2. Probaj kao XML pomoću ultra-robustnog regex-a (otporan na redosled atributa i opcioni dur)
    const segments = [];
    const regex = /<text([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const attrs = match[1];
      let t = match[2];
      
      const startMatch = attrs.match(/start="([\d.]+)"/i);
      const durMatch = attrs.match(/dur="([\d.]+)"/i);
      
      const startSec = startMatch ? parseFloat(startMatch[1]) : 0;
      const durSec = durMatch ? parseFloat(durMatch[1]) : 0;
      
      t = stripHtmlTags(t)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .trim();

      if (t) {
        segments.push({ text: t, startSec, durSec });
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

      if (text) {
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
      const existing = document.querySelector(sel);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // ======= Strategija 1: baseUrl iz ytInitialPlayerResponse =======
  async function tryBaseUrl() {
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
      const resp = await fetch(url, { credentials: 'include' });
      const txt = await resp.text();
      dbg(`M1: HTTP ${resp.status} CT=${resp.headers.get('content-type')||'?'} len=${txt.length}`);
      if (resp.ok && txt.length > 50) {
        const segments = parseCaptions(txt);
        dbg(`M1: ${segments.length} segments parsed`);
        if (segments.length > 0) return segments;
      }
    } catch (e) { dbg(`M1 err: ${e.message}`); }
    return null;
  }

  // ======= Strategija 2: /get_transcript iz MAIN world-a =======
  async function tryInnerTube() {
    dbg("M2: /get_transcript from MAIN world");
    let transcriptParams = null;
    if (window.ytInitialData?.engagementPanels) {
      // Staleness check: ytInitialData may belong to a previously viewed video on SPA navigation
      const ytDataVideoId = window.ytInitialData?.currentVideoEndpoint?.watchEndpoint?.videoId
        || window.ytInitialData?.playerOverlays?.playerOverlayRenderer?.videoDetails?.playerOverlayVideoDetailsRenderer?.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
      if (ytDataVideoId && ytDataVideoId !== videoId) {
        dbg(`M2: stale ytInitialData (${ytDataVideoId} != ${videoId}), skipping`);
        return null;
      }
      for (const panel of window.ytInitialData.engagementPanels) {
        const r = panel.engagementPanelSectionListRenderer;
        if (r?.panelIdentifier === 'engagement-panel-searchable-transcript') {
          const endpoint = r.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint;
          if (endpoint?.params) {
            transcriptParams = decodeURIComponent(endpoint.params);
            dbg(`M2: params found (${transcriptParams.substring(0, 30)}...)`);
          }
          break;
        }
      }
    }

    if (!transcriptParams) {
      dbg("M2: params not found in ytInitialData");
      return null;
    }

    // Dynamic API key extraction
    let apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    if (!apiKey) {
      const match = document.documentElement.innerHTML.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)
        || document.documentElement.innerHTML.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
      if (match) apiKey = match[1];
    }
    if (!apiKey) apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    // Dynamic client version extraction
    let clientVersion = "2.20260518.01.00";
    if (window.ytcfg?.get?.('INNERTUBE_CONTEXT')?.client?.clientVersion) {
      clientVersion = window.ytcfg.get('INNERTUBE_CONTEXT').client.clientVersion;
    } else {
      const match = document.documentElement.innerHTML.match(/"clientVersion"\s*:\s*"([^"]+)"/)
        || document.documentElement.innerHTML.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
      if (match) clientVersion = match[1];
    }

    let ctx = null;
    if (window.ytcfg?.get?.('INNERTUBE_CONTEXT')) {
      try {
        ctx = JSON.parse(JSON.stringify(window.ytcfg.get('INNERTUBE_CONTEXT')));
      } catch (e) {
        dbg(`M2: failed to clone INNERTUBE_CONTEXT: ${e.message}`);
      }
    }

    if (!ctx) {
      ctx = {
        client: {
          clientName: "WEB",
          clientVersion: clientVersion,
          hl: window.ytcfg?.get?.('HL') || "en",
          gl: window.ytcfg?.get?.('GL') || "US",
          utcOffsetMinutes: -new Date().getTimezoneOffset()
        }
      };
    } else if (ctx.client) {
      // Ensure clientVersion is up to date in the cloned context
      ctx.client.clientVersion = clientVersion;
    }

    try {
      const resp = await fetch(`/youtubei/v1/get_transcript?key=${apiKey}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, params: transcriptParams })
      });
      dbg(`M2: HTTP ${resp.status}`);

      if (!resp.ok) {
        const errTxt = await resp.text();
        dbg(`M2: err: ${errTxt.substring(0, 150)}`);
        return null;
      }

      const data = await resp.json();
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
      dbg(`M2: ${segments.length} segments`);
      return segments.length > 0 ? segments : null;
    } catch (e) {
      dbg(`M2 err: ${e.message}`);
      return null;
    }
  }

  // ======= Strategija 3: DOM Scraping =======
  async function tryDomScraping() {
    dbg("M3: DOM scraping");

    // Provera da li su segmenti već u DOM-u (npr. otvoren sidebar)
    let transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (transcriptSegs.length > 0) {
      dbg(`M3: found ${transcriptSegs.length} segments already present in DOM`);
      return readTranscriptFromDOM(transcriptSegs);
    }

    let descriptionBtnFound = false;

    // Strategija A: Transcript dugme u opisu videa
    dbg("M3-A: transcript button in description");
    try {
      const expandBtns = document.querySelectorAll(
        'tp-yt-paper-button#expand, #description-inline-expander tp-yt-paper-button, ' +
        '#snippet #expand, ytd-text-inline-expander #expand'
      );
      for (const btn of expandBtns) {
        if (btn.offsetParent !== null) { 
          btn.click(); 
          await new Promise(r => setTimeout(r, 300)); 
          break; 
        }
      }
      const descTranscriptBtn = document.querySelector(
        'ytd-video-description-transcript-section-renderer button, ' +
        'ytd-video-description-transcript-section-renderer ytd-button-renderer, ' +
        'ytd-video-description-transcript-section-renderer #button'
      );
      if (descTranscriptBtn) {
        descriptionBtnFound = true;
        dbg("M3-A: click on transcript button in description");
        descTranscriptBtn.click();
        const segEl = await waitForEl('ytd-transcript-segment-renderer', 2500);
        if (segEl) {
          await new Promise(r => setTimeout(r, 300));
          transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (transcriptSegs.length > 0) {
            dbg(`M3-A: found ${transcriptSegs.length} segments`);
            return readTranscriptFromDOM(transcriptSegs);
          }
        }
      } else {
        dbg("M3-A: no transcript button in description");
      }
    } catch (e) { dbg(`M3-A err: ${e.message}`); }

    // Strategija B: Tri-tačke meni → "Show transcript" (samo ako opis dugme nije nađeno)
    if (!descriptionBtnFound) {
      dbg("M3-B: three-dot menu");
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
          dbg("M3-B: click on menu button");
          menuBtn.click();
          await new Promise(r => setTimeout(r, 500));

          const menuItems = document.querySelectorAll(
            'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
            'ytd-menu-popup-renderer tp-yt-paper-item, ' +
            'ytd-popup-container ytd-menu-service-item-renderer'
          );
          dbg(`M3-B: ${menuItems.length} items in menu`);

          let found = false;
          for (const item of menuItems) {
            const txt = (item.textContent || '').toLowerCase();
            if (txt.includes('transcript') || txt.includes('transkript') || txt.includes('prepis')) {
              dbg(`M3-B: click on "${item.textContent.trim().substring(0, 30)}"`);
              item.click();
              found = true;
              break;
            }
          }

          if (found) {
            const segEl = await waitForEl('ytd-transcript-segment-renderer', 2500);
            if (segEl) {
              await new Promise(r => setTimeout(r, 300));
              transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
              dbg(`M3-B: ${transcriptSegs.length} segments`);
              if (transcriptSegs.length > 0) return readTranscriptFromDOM(transcriptSegs);
            } else {
              dbg("M3-B: segments did not appear");
            }
          } else {
            document.body.click();
            dbg("M3-B: transcript option not found");
          }
        } else {
          dbg("M3-B: menu button not found");
        }
      } catch (e) { dbg(`M3-B err: ${e.message}`); }
    } else {
      dbg("M3-B skipped: description button was found");
    }

    // Strategija C: Direktno proveri engagement panel
    dbg("M3-C: engagement panel check");
    try {
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
      for (const panel of panels) {
        const panelId = panel.getAttribute('panel-id') || panel.getAttribute('target-id') || '';
        if (panelId.includes('transcript')) {
          dbg(`M3-C: panel id="${panelId}" visibility=${panel.getAttribute('visibility')}`);
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
          // Brzo periodično proveravanje umesto 2 sekunde bezuslovnog čekanja
          for (let i = 0; i < 10; i++) {
            transcriptSegs = panel.querySelectorAll('ytd-transcript-segment-renderer');
            if (transcriptSegs.length > 0) {
              dbg(`M3-C: ${transcriptSegs.length} segments from panel`);
              return readTranscriptFromDOM(transcriptSegs);
            }
            await new Promise(r => setTimeout(r, 150));
          }
        }
      }
      dbg(`M3-C: ${panels.length} panels, none with transcript`);
    } catch (e) { dbg(`M3-C err: ${e.message}`); }

    return null;
  }

  function getChapters() {
    try {
      const markers = window.ytInitialPlayerResponse?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
      if (!markers) return [];

      const macroMarkers = markers.find(m => m.key === 'MARKER_TYPE_HASHTAGS' || m.key === 'AUTO_CHAPTERS' || m.value?.chapters);
      const chapters = macroMarkers?.value?.chapters || [];

      return chapters.map(c => ({
        title: c.chapterRenderer?.title?.simpleText || '',
        timeSec: parseInt(c.chapterRenderer?.timeRangeStartMillis || '0') / 1000
      })).filter(c => c.title);
    } catch (e) {
      dbg("Chapters err: " + e.message);
      return [];
    }
  }

  // ======= Glavni fallback loop =======
  try {
    const chapters = getChapters();
    if (chapters.length > 0) dbg(`Found ${chapters.length} chapters`);

    // Pokrećemo tryBaseUrl i tryInnerTube u paraleli radi maksimalne brzine
    const results = await Promise.all([
      tryBaseUrl().catch(e => { dbg(`tryBaseUrl catch: ${e.message}`); return null; }),
      tryInnerTube().catch(e => { dbg(`tryInnerTube catch: ${e.message}`); return null; })
    ]);

    if (results[0] && results[0].length > 0) {
      return { status: 'ok', segments: results[0], chapters, debugLines: D };
    }
    if (results[1] && results[1].length > 0) {
      return { status: 'ok', segments: results[1], chapters, debugLines: D };
    }

    // Ako brze API metode ne uspeju, prelazimo na DOM Scraping
    const domSegments = await tryDomScraping();
    if (domSegments && domSegments.length > 0) {
      return { status: 'ok', segments: domSegments, chapters, debugLines: D };
    }

    return { status: 'error', error: 'All methods failed.', debugLines: D };
  } catch (e) {
    return { status: 'error', error: e.message, debugLines: D };
  }
}
