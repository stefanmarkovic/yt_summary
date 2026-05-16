// Konsolidovani modul za preuzimanje, filtriranje i formatiranje transkripta.
// Apsorbuje logiku iz bivših transcript-parser.js i sponsor-filter.js.
// Interfejs: getProcessedTranscript(tabId, videoId) → {text, savedSeconds, categoryStats, ...}

async function getSponsorSegments(videoId) {
  try {
    const resp = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["sponsor","selfpromo","interaction","intro","outro"]`);
    return resp.ok ? await resp.json() : [];
  } catch { return []; }
}

/**
 * @param {number} tabId - Tab ID za scripting.executeScript
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<{text: string, savedSeconds: number, categoryStats: object, debugLines: string[], segmentCount: number, sponsorCount: number, chapters: Array}>}
 */
async function getProcessedTranscript(tabId, videoId) {
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
  if (!scriptResult) throw new Error("executeScript did not return a result.");

  const debugLines = scriptResult.debugLines || [];
  if (scriptResult.status === 'error') throw new Error(scriptResult.error);

  const segments = scriptResult.segments;
  if (!segments || segments.length === 0) throw new Error("No segments in transcript.");
  
  const chapters = scriptResult.chapters || [];

  // 3. SponsorBlock filtriranje
  const categoryStats = {};
  for (const seg of sponsorSegments) {
    const cat = seg.category || 'unknown';
    const duration = (seg.segment?.[1] || 0) - (seg.segment?.[0] || 0);
    categoryStats[cat] = (categoryStats[cat] || 0) + duration;
  }

  const skipRanges = sponsorSegments.map(s => s.segment);
  let savedSeconds = 0;
  const filtered = segments.filter(seg => {
    const segEnd = seg.startSec + seg.durSec;
    const isSkipped = skipRanges.some(([s, e]) => seg.startSec < e && segEnd > s);
    if (isSkipped) { savedSeconds += seg.durSec; return false; }
    return true;
  });

  // 4. Formatiranje teksta sa vremenskim oznakama
  const text = filtered.map(s => {
    const min = Math.floor(s.startSec / 60);
    const sec = Math.floor(s.startSec % 60).toString().padStart(2, '0');
    return `[${min}:${sec}] ${s.text}`;
  }).join(' ');

  return {
    text,
    savedSeconds,
    categoryStats,
    debugLines,
    segmentCount: segments.length,
    sponsorCount: sponsorSegments.length,
    chapters
  };
}
