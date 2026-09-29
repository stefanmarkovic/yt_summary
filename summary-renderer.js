// summary-renderer.js — Reusable summary card rendering
// Used by result.js and playlist.js. Depends on: markdownToHtml, setSafeHTML (from markdown-renderer.js)
/* exported renderSummaryCard */

const CATEGORY_LABELS = {
  sponsor: { label: 'category_sponsor', icon: '💰' },
  selfpromo: { label: 'category_selfpromo', icon: '📢' },
  interaction: { label: 'category_interaction', icon: '👆' },
  intro: { label: 'category_intro', icon: '🎬' },
  outro: { label: 'category_outro', icon: '🔚' },
  unknown: { label: 'category_unknown', icon: '⏭️' }
};

function formatDuration(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Renders a complete summary card into a container element.
 * @param {HTMLElement} container - DOM element to render into
 * @param {Object} result - {summary, title, videoId, videoUrl, sponsorSaved, categoryStats, entities, usage}
 * @param {Object} config - LLM config (for model name in usage display)
 * @returns {{ summaryText: string, tldr: string|null, wordCount: number, readTime: number }}
 */
function renderSummaryCard(container, result, config, { showTldr = true } = {}) {
  const localize = key => getLocalizedString(key, config?.uiLanguage || 'en');
  let summaryText = String(result.summary || '');
  let tldr = null;

  // TL;DR extraction
  const tldrMatch = summaryText.match(/^(?:\*\*)?TL;DR:(?:\*\*)?[ \t]*(.*?)(?:\r?\n|$)/im);
  if (tldrMatch) {
    tldr = tldrMatch[1];
    summaryText = summaryText.replace(tldrMatch[0], '').trim();
  }

  const wordCount = summaryText.trim() ? summaryText.trim().split(/\s+/).length : 0;
  const readTime = Math.ceil(wordCount / 200);

  // Build HTML
  let html = '';

  // TL;DR section
  if (tldr && showTldr) {
    html += `<div class="info-card tldr-card" style="padding:12px; margin-bottom:15px; border-radius:6px; background:rgba(255, 215, 0, 0.1); border:1px solid rgba(255, 215, 0, 0.3);">
      <h4 style="margin:0 0 5px 0; font-size:14px; color:#ffd700;">${localize('tldr_title')}</h4>
      <p style="margin:0; font-size:13px; line-height:1.4; color:white;">${escapeHtml(tldr)}</p>
    </div>`;
  }

  // Summary body
  html += `<div class="summary-body">${markdownToHtml(summaryText)}</div>`;

  // Entities
  if (Array.isArray(result.entities) && result.entities.length > 0) {
    html += `<div class="info-card entity-card" style="padding:12px; margin-top:15px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1);">
      <h4 style="margin:0 0 10px 0; font-size:13px; color:#aaa;">${localize('entity_title')}</h4>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${result.entities.map(e => `<span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 12px; font-size: 11px; white-space: nowrap;">${escapeHtml(e)}</span>`).join('')}
      </div>
    </div>`;
  }

  // SponsorBlock
  if (result.sponsorSaved && result.sponsorSaved > 0) {
    const stats = result.categoryStats || {};
    const categories = Object.entries(stats).sort((a, b) => b[1] - a[1]);

    let sponsorHtml = `<div class="sponsor-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>${localize('sponsor_filtered')} <strong>${formatDuration(result.sponsorSaved)}</strong></span>
    </div>`;

    if (categories.length > 0) {
      sponsorHtml += '<div class="sponsor-categories">';
      for (const [cat, dur] of categories) {
        const info = CATEGORY_LABELS[cat] || CATEGORY_LABELS.unknown;
        sponsorHtml += `<div class="sponsor-cat">
          <span class="cat-icon">${info.icon}</span>
          <span class="cat-label">${localize(info.label)}</span>
          <span class="cat-dur">${formatDuration(dur)}</span>
        </div>`;
      }
      sponsorHtml += '</div>';
    }

    html += `<div class="info-card sponsor-card" style="display:block;">${sponsorHtml}</div>`;
  }

  // Usage
  if (result.usage && config) {
    const u = result.usage;
    html += `<div class="info-card usage-card" style="display:block;">
      <div class="usage-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg>
        <span>${escapeHtml(config.model || 'LLM')}</span>
      </div>
      <div class="usage-grid">
        <div class="usage-item">
          <span class="usage-label">${localize('usage_input')}</span>
          <span class="usage-value">${(Number(u.promptTokens) || 0).toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">${localize('usage_output')}</span>
          <span class="usage-value">${(Number(u.outputTokens) || 0).toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">${localize('usage_total')}</span>
          <span class="usage-value">${(Number(u.totalTokens) || 0).toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">${localize('usage_cost')}</span>
          <span class="usage-cost">~$${escapeHtml(u.estimatedCost ?? '0')}</span>
        </div>
      </div>
    </div>`;
  }

  setSafeHTML(container, html);

  // Wire timestamp click listeners
  if (result.videoUrl) {
    container.querySelectorAll('.timestamp-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const timeStr = link.getAttribute('data-time');
        const [m, s] = timeStr.split(':');
        const seconds = parseInt(m) * 60 + parseInt(s);
        const url = new URL(result.videoUrl);
        if (!['https:', 'http:'].includes(url.protocol)) return;
        url.searchParams.set('t', `${seconds}s`);
        browser.tabs.create({ url: url.href });
      });
    });
  }

  return { summaryText, tldr, wordCount, readTime };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderSummaryCard, formatDuration };
}
