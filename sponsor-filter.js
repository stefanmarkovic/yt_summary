// SponsorBlock API + filtriranje segmenata

async function getSponsorSegments(videoId) {
  try {
    const resp = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["sponsor","selfpromo","interaction","intro","outro"]`);
    return resp.ok ? await resp.json() : [];
  } catch { return []; }
}

function filterSegments(segments, sponsorSegments) {
  // Prati kategorije sa vremenima
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
  return { text: filtered.map(s => s.text).join(' '), savedSeconds, categoryStats };
}
