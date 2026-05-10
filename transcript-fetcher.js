// Ova funkcija se izvršava u MAIN world-u (YouTube page kontekst).
// Ima pristup: cookie-jima, ytInitialPlayerResponse, ytInitialData, ytcfg
// Koristi se iz popup.js via scripting.executeScript({func: fetchTranscriptInPageContext})

async function fetchTranscriptInPageContext(videoId) {
  const D = [];
  function dbg(msg) { D.push(msg); }

  function makeXml(segments) {
    let xml = '<?xml version="1.0" encoding="utf-8" ?><transcript>';
    for (const seg of segments) {
      const esc = seg.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      xml += `<text start="${seg.start}" dur="${seg.dur}">${esc}</text>`;
    }
    xml += '</transcript>';
    return xml;
  }

  function readTranscriptFromDOM(segs) {
    const segments = [];
    segs.forEach((seg, i) => {
      const textEl = seg.querySelector('.segment-text, yt-formatted-string.segment-text, yt-formatted-string') || seg;
      const timeEl = seg.querySelector('.segment-timestamp, .segment-start-offset');
      const text = (textEl.textContent || '').trim();
      let startSec = i * 5;
      if (timeEl) {
        const parts = timeEl.textContent.trim().replace(/\s/g, '').split(':').map(Number);
        if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
        if (parts.length === 3) startSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      if (text) segments.push({ text, start: startSec.toFixed(3), dur: '5.000' });
    });
    return { status: 'ok', transcriptXml: makeXml(segments), debugLines: D };
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

  try {
    // ======= METOD 1: baseUrl iz ytInitialPlayerResponse =======
    dbg("M1: ytInitialPlayerResponse baseUrl");
    let captionTracks = null;
    if (window.ytInitialPlayerResponse) {
      const ct = window.ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (ct?.length) {
        captionTracks = ct;
        dbg(`M1: ${ct.length} tracks`);
      }
    }

    if (captionTracks) {
      const track = captionTracks.find(t => t.languageCode === 'sr') ||
                    captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
                    captionTracks.find(t => t.languageCode === 'en') ||
                    captionTracks[0];
      dbg(`M1: track=${track.languageCode}(${track.kind || 'manual'})`);

      const url = track.baseUrl.replace(/&fmt=srv3/g, '').replace(/&fmt=json3/g, '');
      try {
        const resp = await fetch(url, { credentials: 'include' });
        const txt = await resp.text();
        dbg(`M1: HTTP ${resp.status} CT=${resp.headers.get('content-type')||'?'} len=${txt.length}`);
        if (resp.ok && txt.length > 50) {
          return { status: 'ok', transcriptXml: txt, debugLines: D };
        }
      } catch (e) { dbg(`M1 err: ${e.message}`); }
    }

    // ======= METOD 2: /get_transcript iz MAIN world-a =======
    dbg("M2: /get_transcript iz MAIN world");
    try {
      let transcriptParams = null;
      if (window.ytInitialData?.engagementPanels) {
        for (const panel of window.ytInitialData.engagementPanels) {
          const r = panel.engagementPanelSectionListRenderer;
          if (r?.panelIdentifier === 'engagement-panel-searchable-transcript') {
            const endpoint = r.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint;
            if (endpoint?.params) {
              transcriptParams = endpoint.params;
              dbg(`M2: params pronađeni (${transcriptParams.substring(0, 30)}...)`);
            }
            break;
          }
        }
      }

      if (transcriptParams) {
        const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY') || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
        const ctx = window.ytcfg?.get?.('INNERTUBE_CONTEXT') || { client: { clientName: "WEB", clientVersion: "2.20240101" } };

        const resp = await fetch(`/youtubei/v1/get_transcript?key=${apiKey}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: ctx, params: transcriptParams })
        });
        dbg(`M2: HTTP ${resp.status}`);

        if (resp.ok) {
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
                    segments.push({ text, start: (startMs / 1000).toFixed(3), dur: ((endMs - startMs) / 1000).toFixed(3) });
                  }
                }
              }
            }
          }
          dbg(`M2: ${segments.length} segmenata`);
          if (segments.length > 0) {
            return { status: 'ok', transcriptXml: makeXml(segments), debugLines: D };
          }
        } else {
          const errTxt = await resp.text();
          dbg(`M2: err: ${errTxt.substring(0, 150)}`);
        }
      } else {
        dbg("M2: params nisu pronađeni u ytInitialData");
      }
    } catch (e) { dbg(`M2 err: ${e.message}`); }

    // ======= METOD 3: DOM Scraping =======
    dbg("M3: DOM scraping");

    // Strategija A: Transcript dugme u opisu videa
    dbg("M3-A: transcript button u opisu");
    try {
      const expandBtns = document.querySelectorAll(
        'tp-yt-paper-button#expand, #description-inline-expander tp-yt-paper-button, ' +
        '#snippet #expand, ytd-text-inline-expander #expand'
      );
      for (const btn of expandBtns) {
        if (btn.offsetParent !== null) { btn.click(); await new Promise(r => setTimeout(r, 500)); break; }
      }
      const descTranscriptBtn = document.querySelector(
        'ytd-video-description-transcript-section-renderer button, ' +
        'ytd-video-description-transcript-section-renderer ytd-button-renderer, ' +
        'ytd-video-description-transcript-section-renderer #button'
      );
      if (descTranscriptBtn) {
        dbg("M3-A: klik na transcript dugme u opisu");
        descTranscriptBtn.click();
        await waitForEl('ytd-transcript-segment-renderer', 5000);
      } else {
        dbg("M3-A: nema transcript dugmeta u opisu");
      }
    } catch (e) { dbg(`M3-A err: ${e.message}`); }

    let transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (transcriptSegs.length > 0) {
      dbg(`M3: pronađeno ${transcriptSegs.length} segmenata`);
      return readTranscriptFromDOM(transcriptSegs);
    }

    // Strategija B: Tri-tačke meni → "Show transcript"
    dbg("M3-B: tri-tačke meni");
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
        dbg("M3-B: klik na meni dugme");
        menuBtn.click();
        await new Promise(r => setTimeout(r, 800));

        const menuItems = document.querySelectorAll(
          'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
          'ytd-menu-popup-renderer tp-yt-paper-item, ' +
          'ytd-popup-container ytd-menu-service-item-renderer'
        );
        dbg(`M3-B: ${menuItems.length} stavki u meniju`);

        let found = false;
        for (const item of menuItems) {
          const txt = (item.textContent || '').toLowerCase();
          if (txt.includes('transcript') || txt.includes('transkript') || txt.includes('prepis')) {
            dbg(`M3-B: klik na "${item.textContent.trim().substring(0, 30)}"`);
            item.click();
            found = true;
            break;
          }
        }

        if (found) {
          const segEl = await waitForEl('ytd-transcript-segment-renderer', 5000);
          if (segEl) {
            await new Promise(r => setTimeout(r, 1000));
            transcriptSegs = document.querySelectorAll('ytd-transcript-segment-renderer');
            dbg(`M3-B: ${transcriptSegs.length} segmenata`);
            if (transcriptSegs.length > 0) return readTranscriptFromDOM(transcriptSegs);
          } else {
            dbg("M3-B: segmenti se nisu pojavili");
          }
        } else {
          document.body.click();
          dbg("M3-B: transcript opcija nije pronađena");
        }
      } else {
        dbg("M3-B: meni dugme nije pronađeno");
      }
    } catch (e) { dbg(`M3-B err: ${e.message}`); }

    // Strategija C: Direktno proveri engagement panel
    dbg("M3-C: engagement panel check");
    try {
      const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
      for (const panel of panels) {
        const panelId = panel.getAttribute('panel-id') || panel.getAttribute('target-id') || '';
        if (panelId.includes('transcript')) {
          dbg(`M3-C: panel id="${panelId}" visibility=${panel.getAttribute('visibility')}`);
          panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
          await new Promise(r => setTimeout(r, 2000));
          transcriptSegs = panel.querySelectorAll('ytd-transcript-segment-renderer');
          if (transcriptSegs.length > 0) {
            dbg(`M3-C: ${transcriptSegs.length} segmenata iz panela`);
            return readTranscriptFromDOM(transcriptSegs);
          }
        }
      }
      dbg(`M3-C: ${panels.length} panela, nijedan sa transkriptom`);
    } catch (e) { dbg(`M3-C err: ${e.message}`); }

    return { status: 'error', error: 'Svi metodi neuspešni.', debugLines: D };

  } catch (e) {
    return { status: 'error', error: e.message, debugLines: D };
  }
}
