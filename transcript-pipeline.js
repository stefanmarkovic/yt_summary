// Konsolidovani modul za preuzimanje, filtriranje i formatiranje transkripta.
// Apsorbuje logiku iz bivših transcript-parser.js i sponsor-filter.js.
// Interfejs: getProcessedTranscript(tabId, videoId) → {text, savedSeconds, categoryStats, ...}
/* exported getProcessedTranscript, getSponsorSegments, processTranscriptSegments */

const SPONSORBLOCK_DEADLINE_MS = 350;
const TRANSCRIPT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TRANSCRIPT_CACHE_KEY = 'yt_transcript_cache';

async function getSponsorSegments(videoId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SPONSORBLOCK_DEADLINE_MS);
  try {
    const query = new URLSearchParams({ videoID: videoId, categories: JSON.stringify(['sponsor', 'selfpromo', 'interaction', 'intro', 'outro']) });
    const resp = await fetch(`https://sponsor.ajay.app/api/skipSegments?${query}`, {
      signal: controller.signal
    });
    const data = resp.ok ? await resp.json() : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getCachedTranscript(videoId) {
  try {
    if (!browser.storage?.session) return null;
    const stored = await browser.storage.session.get(TRANSCRIPT_CACHE_KEY);
    const cached = stored[TRANSCRIPT_CACHE_KEY];
    if (!cached || cached.videoId !== videoId) return null;
    if (!Number.isFinite(cached.cachedAt) || cached.cachedAt > Date.now()
      || Date.now() - cached.cachedAt > TRANSCRIPT_CACHE_TTL_MS) return null;
    return typeof cached.result?.text === 'string' && cached.result.text.trim() ? cached.result : null;
  } catch {
    return null;
  }
}

async function cacheTranscript(videoId, result) {
  try {
    if (!browser.storage?.session) return;
    await browser.storage.session.set({
      [TRANSCRIPT_CACHE_KEY]: { videoId, cachedAt: Date.now(), result }
    });
  } catch {
    // Cache je optimizacija; kvar skladišta ne sme da obori analizu.
  }
}

/**
 * @param {number} tabId - Tab ID za scripting.executeScript
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<{text: string, savedSeconds: number, categoryStats: object, debugLines: string[], segmentCount: number, sponsorCount: number, chapters: Array}>}
 */
async function getProcessedTranscript(tabId, videoId) {
  const cached = await getCachedTranscript(videoId);
  if (cached) {
    return {
      ...cached,
      debugLines: [...(cached.debugLines || []), 'Transcript cache hit']
    };
  }

  // 1. SponsorBlock — paralelno sa transkriptom
  const [sponsorSegments, results] = await Promise.all([
    getSponsorSegments(videoId),
    browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: fetchTranscriptInPageContext,
      args: [videoId]
    })
  ]);

  // 2. Obrada rezultata iz MAIN world-a
  const scriptResult = results[0]?.result;
  if (!scriptResult) {
    const err = new Error("executeScript did not return a result.");
    err.debugLines = [];
    throw err;
  }

  const debugLines = Array.isArray(scriptResult.debugLines) ? scriptResult.debugLines : [];
  if (scriptResult.status !== 'ok') {
    const err = new Error(scriptResult.error || "All methods failed.");
    err.debugLines = debugLines;
    throw err;
  }

  const segments = scriptResult.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    const err = new Error("No segments in transcript.");
    err.debugLines = debugLines;
    throw err;
  }

  const result = processTranscriptSegments(segments, sponsorSegments, scriptResult.chapters, debugLines);
  await cacheTranscript(videoId, result);
  return result;
}

function rangeDuration(ranges) {
  let duration = 0;
  let end = -Infinity;
  for (const [start, stop] of ranges.slice().sort((a, b) => a[0] - b[0])) {
    duration += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return duration;
}

function processTranscriptSegments(rawSegments, rawSponsors = [], chapters = [], debugLines = []) {
  const segments = (Array.isArray(rawSegments) ? rawSegments : []).filter(seg => (
    typeof seg?.text === 'string' && seg.text.trim() && Number.isFinite(seg.startSec) && seg.startSec >= 0
  )).map(seg => ({ ...seg, text: seg.text.trim(), durSec: Number.isFinite(seg.durSec) && seg.durSec > 0 ? seg.durSec : 0 }))
    .sort((a, b) => a.startSec - b.startSec);
  // Some caption formats omit duration; infer it from the next caption when possible.
  for (let i = 0; i < segments.length - 1; i++) {
    if (!segments[i].durSec) segments[i].durSec = Math.max(0, segments[i + 1].startSec - segments[i].startSec);
  }
  const sponsorSegments = (Array.isArray(rawSponsors) ? rawSponsors : []).filter(seg => (
    Array.isArray(seg?.segment) && seg.segment.length === 2 && seg.segment.every(Number.isFinite)
    && seg.segment[0] >= 0 && seg.segment[1] > seg.segment[0]
    && ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro'].includes(seg.category)
  ));

  // 3. SponsorBlock filtriranje
  const categoryStats = {};
  for (const seg of sponsorSegments) {
    const cat = seg.category;
    categoryStats[cat] = rangeDuration(sponsorSegments.filter(item => item.category === cat).map(item => item.segment));
  }

  const skipRanges = sponsorSegments.map(s => s.segment);
  const removedRanges = [];
  const filtered = segments.filter(seg => {
    const segEnd = seg.startSec + seg.durSec;
    const overlap = rangeDuration(skipRanges.map(([s, e]) => [Math.max(s, seg.startSec), Math.min(e, segEnd)])
      .filter(([s, e]) => e > s));
    // Keep boundary captions when most of their duration is useful speech.
    const isSkipped = seg.durSec > 0 ? overlap >= seg.durSec / 2
      : skipRanges.some(([s, e]) => seg.startSec >= s && seg.startSec < e);
    if (isSkipped) { removedRanges.push([seg.startSec, segEnd]); return false; }
    return true;
  });

  // 4. Formatiranje teksta sa vremenskim oznakama
  const text = filtered.map(s => {
    const min = Math.floor(s.startSec / 60);
    const sec = Math.floor(s.startSec % 60).toString().padStart(2, '0');
    return `[${min}:${sec}] ${s.text}`;
  }).join(' ');

  if (!text.trim()) {
    const error = new Error(segments.length ? 'No transcript remains after sponsor filtering.' : 'No valid segments in transcript.');
    error.debugLines = debugLines;
    throw error;
  }
  return {
    text,
    savedSeconds: rangeDuration(removedRanges),
    categoryStats,
    debugLines,
    segmentCount: segments.length,
    sponsorCount: sponsorSegments.length,
    chapters: Array.isArray(chapters) ? chapters : []
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getProcessedTranscript, getSponsorSegments, processTranscriptSegments };
}
