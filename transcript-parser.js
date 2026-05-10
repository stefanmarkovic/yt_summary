// Parsiranje XML transkripta u niz segmenata {text, startSec, durSec}

function parseXmlTranscript(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const segments = [];
  for (const el of doc.querySelectorAll('text')) {
    if (!el.textContent) continue;
    const text = el.textContent.replace(/<[^>]*>/g, '');
    segments.push({
      text,
      startSec: parseFloat(el.getAttribute('start') || '0'),
      durSec: parseFloat(el.getAttribute('dur') || '0')
    });
  }
  return segments;
}
