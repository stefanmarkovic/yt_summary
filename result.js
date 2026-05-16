// result.js — Thin orchestrator: wires modules, manages UI state

const CATEGORY_LABELS = {
  sponsor: { label: 'Sponzor', icon: '💰' },
  selfpromo: { label: 'Samopromocija', icon: '📢' },
  interaction: { label: 'Interakcija', icon: '👆' },
  intro: { label: 'Intro', icon: '🎬' },
  outro: { label: 'Outro', icon: '🔚' },
  unknown: { label: 'Ostalo', icon: '⏭️' }
};

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

let currentTranscript = "";
let currentConfig = null;
let currentResult = null;

function updateSummaryUI(result) {
  currentResult = result;
  document.getElementById('video-title').textContent = result.title || 'Video sažetak';
  document.title = `Sažetak: ${result.title || 'Video'}`;
  document.getElementById('meta-date').textContent = new Date(result.timestamp).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric' });
  
  let summaryText = result.summary;
  const tldrMatch = summaryText.match(/TL;DR:\s*(.*?)(\n|$)/i);
  if (tldrMatch) {
    const tldr = tldrMatch[1];
    document.getElementById('tldr-text').textContent = tldr;
    document.getElementById('tldr-container').style.display = 'block';
    summaryText = summaryText.replace(tldrMatch[0], '').trim();
  } else {
    document.getElementById('tldr-container').style.display = 'none';
  }

  const wordCount = summaryText.split(/\s+/).length;
  const readTime = Math.ceil(wordCount / 200);
  document.getElementById('meta-words').textContent = `~${wordCount} words (${readTime} min read)`;

  setSafeHTML(document.getElementById('summary'), markdownToHtml(summaryText));

  // Add click listeners to newly rendered timestamps
  document.querySelectorAll('.timestamp-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const timeStr = link.getAttribute('data-time');
      const [m, s] = timeStr.split(':');
      const seconds = parseInt(m) * 60 + parseInt(s);
      browser.tabs.create({ url: result.videoUrl + "&t=" + seconds + "s" });
    });
  });

  // === Entities ===
  const entityContainer = document.getElementById('entity-info');
  const entityTags = document.getElementById('entity-tags');
  if (result.entities && result.entities.length > 0) {
    entityTags.replaceChildren();
    result.entities.forEach(entity => {
      const span = document.createElement('span');
      span.textContent = entity;
      span.style.cssText = "background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 12px; font-size: 11px; white-space: nowrap;";
      entityTags.appendChild(span);
    });
    entityContainer.style.display = 'block';
  } else {
    entityContainer.style.display = 'none';
  }

  // === SponsorBlock detalji ===
  const sponsorContainer = document.getElementById('sponsor-info');
  if (result.sponsorSaved && result.sponsorSaved > 0) {
    const stats = result.categoryStats || {};
    const categories = Object.entries(stats).sort((a, b) => b[1] - a[1]);

    let html = `<div class="sponsor-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>SponsorBlock filtrirao <strong>${formatDuration(result.sponsorSaved)}</strong></span>
    </div>`;

    if (categories.length > 0) {
      html += '<div class="sponsor-categories">';
      for (const [cat, dur] of categories) {
        const info = CATEGORY_LABELS[cat] || CATEGORY_LABELS.unknown;
        html += `<div class="sponsor-cat">
          <span class="cat-icon">${info.icon}</span>
          <span class="cat-label">${info.label}</span>
          <span class="cat-dur">${formatDuration(dur)}</span>
        </div>`;
      }
      html += '</div>';
    }

    sponsorContainer.style.display = 'block';
    setSafeHTML(sponsorContainer, html);
  } else {
    sponsorContainer.style.display = 'none';
  }

  // === Token / Cost info ===
  const usageContainer = document.getElementById('usage-info');
  if (result.usage && currentConfig) {
    const u = result.usage;
    setSafeHTML(usageContainer, `
      <div class="usage-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg>
        <span>${currentConfig.model || 'LLM'}</span>
      </div>
      <div class="usage-grid">
        <div class="usage-item">
          <span class="usage-label">Input tokeni</span>
          <span class="usage-value">${u.promptTokens.toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">Output tokeni</span>
          <span class="usage-value">${u.outputTokens.toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">Ukupno</span>
          <span class="usage-value">${u.totalTokens.toLocaleString()}</span>
        </div>
        <div class="usage-item">
          <span class="usage-label">Cena poziva</span>
          <span class="usage-cost">~$${u.estimatedCost}</span>
        </div>
      </div>
    `);
    usageContainer.style.display = 'block';
  } else {
    usageContainer.style.display = 'none';
  }
}

function generateWordCloud(transcript) {
  const container = document.getElementById('word-cloud-container');
  if (!transcript) {
    container.style.display = 'none';
    return;
  }
  
  const stopWords = new Set(['i', 'a', 'da', 'u', 'je', 'se', 'na', 'to', 'od', 'za', 'ne', 'kao', 'što', 'koji', 'sa', 'ili', 'su', 'samo', 'iz', 'kako', 'ali', 'sve', 'ovo', 'the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'it', 'for', 'on', 'with', 'as', 'this', 'was', 'at', 'by', 'an', 'be', 'from', 'or', 'are', 'you']);
  
  const words = transcript.toLowerCase().replace(/[^\wćčšžđ]+/g, ' ').split(/\s+/);
  const freq = {};
  words.forEach(w => {
    if (w.length > 3 && !stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });
  
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (sorted.length === 0) {
    container.style.display = 'none';
    return;
  }
  
  const maxFreq = sorted[0][1];
  
  container.replaceChildren();
  const title = document.createElement('h4');
  title.textContent = typeof getLocalizedString === 'function' ? getLocalizedString('word_cloud', currentConfig?.uiLanguage || 'en') || 'Keywords' : 'Keywords';
  title.style.cssText = "margin:0 0 10px 0; font-size:13px; color:#aaa;";
  container.appendChild(title);
  
  const cloudDiv = document.createElement('div');
  cloudDiv.style.cssText = "display:flex; flex-wrap:wrap; justify-content:center; gap:8px; align-items:center;";
  
  sorted.forEach(([word, count]) => {
    const span = document.createElement('span');
    span.textContent = word;
    const size = 10 + (count / maxFreq) * 14;
    const opacity = 0.5 + (count / maxFreq) * 0.5;
    span.style.cssText = `font-size: ${size}px; color: rgba(255,255,255,${opacity});`;
    cloudDiv.appendChild(span);
  });
  
  container.appendChild(cloudDiv);
  container.style.display = 'block';
}

async function regenerateSummary(level) {
  if (!currentTranscript || !currentConfig) return;

  const buttons = document.querySelectorAll('.detail-btn');
  buttons.forEach(b => b.disabled = true);
  const summaryEl = document.getElementById('summary');
  summaryEl.style.opacity = '0.5';

  try {
    const storageData = await browser.storage.local.get('yt_summary_result');
    const chapters = storageData.yt_summary_result?.chapters || [];
    
    // Za regeneraciju koristimo istu llmSummarizeLong logiku
    const outputLang = currentConfig.outputLanguage || 'English';
    const result = await llmSummarizeLong(currentConfig, currentTranscript, level, "standard", chapters, outputLang);

    const newResult = {
      ...storageData.yt_summary_result,
      summary: result.text,
      usage: result.usage,
      timestamp: Date.now()
    };

    await browser.storage.local.set({ yt_summary_result: newResult });
    updateSummaryUI(newResult);

    buttons.forEach(b => {
      b.classList.remove('active');
      if (b.dataset.level === level) b.classList.add('active');
    });

  } catch (e) {
    alert("Greška pri regeneraciji: " + e.message);
  } finally {
    buttons.forEach(b => b.disabled = false);
    summaryEl.style.opacity = '1';
  }
}

function handleDownloadTranscript() {
  if (!currentTranscript) return;
  const blob = new Blob([currentTranscript], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transcript-${currentResult?.videoId || 'video'}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  try {
    const localData = await browser.storage.local.get(['yt_summary_result', 'llm_config']);
    const sessionData = await browser.storage.session.get('yt_transcript');

    const result = localData.yt_summary_result;
    currentConfig = localData.llm_config;
    currentTranscript = sessionData.yt_transcript;

    if (currentConfig && typeof localizePage === 'function') {
      localizePage(currentConfig.uiLanguage || 'en');
    }

    if (!result) {
      document.getElementById('loading').replaceChildren();
      const errorMsg = document.createElement('div');
      errorMsg.className = 'loading-text';
      errorMsg.textContent = typeof getLocalizedString === 'function' ? getLocalizedString('status_error', currentConfig?.uiLanguage || 'en') + ' No data to display.' : 'No data to display.';
      document.getElementById('loading').appendChild(errorMsg);
      return;
    }

    updateSummaryUI(result);
    generateWordCloud(currentTranscript);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('page').style.display = 'block';

    // Detail buttons
    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', () => regenerateSummary(btn.dataset.level));
    });

    // Chat — delegated to chat.js (owns chatHistory internally)
    const chatMessages = document.getElementById('chat-messages');
    initChat(currentConfig, currentTranscript, chatMessages,
      document.getElementById('chat-input'),
      document.getElementById('chat-send-btn'));

    // Quiz — delegated to quiz.js
    document.getElementById('generate-quiz-btn').addEventListener('click', () => {
      handleGenerateQuiz(currentConfig, currentTranscript, chatMessages,
        document.getElementById('generate-quiz-btn'));
    });

    // Download transcript
    document.getElementById('download-transcript-btn').addEventListener('click', handleDownloadTranscript);

    // Export Handlers
    document.getElementById('export-html-btn').addEventListener('click', () => {
      const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${currentResult?.title || 'Summary'}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;line-height:1.6;color:#333;}</style>
</head>
<body>
<h1>${currentResult?.title || 'Summary'}</h1>
${markdownToHtml(currentResult?.summary || '')}
</body></html>`;
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `summary-${currentResult?.videoId || 'video'}.html`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('export-pdf-btn').addEventListener('click', () => {
      window.print();
    });

    document.getElementById('export-notion-btn').addEventListener('click', () => {
      const mdContent = `# ${currentResult?.title || 'Summary'}\n\n${currentResult?.summary || ''}`;
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `summary-${currentResult?.videoId || 'video'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Copy buttons
    document.getElementById('copy-md-btn').addEventListener('click', async function() {
      const data = await browser.storage.local.get('yt_summary_result');
      await navigator.clipboard.writeText(data.yt_summary_result.summary);
      this.classList.add('copied');
      const btnText = this.querySelector('.btn-text');
      const original = btnText.textContent;
      btnText.textContent = '✓ Copied!';
      setTimeout(() => {
        this.classList.remove('copied');
        btnText.textContent = original;
      }, 2000);
    });

    document.getElementById('copy-text-btn').addEventListener('click', async function() {
      const tempDiv = document.createElement('div');
      setSafeHTML(tempDiv, document.getElementById('summary').innerHTML);
      const plain = tempDiv.textContent.replace(/\n{3,}/g, '\n\n');
      await navigator.clipboard.writeText(plain);
      this.classList.add('copied');
      const btnText = this.querySelector('.btn-text');
      const original = btnText.textContent;
      btnText.textContent = '✓ Copied!';
      setTimeout(() => {
        this.classList.remove('copied');
        btnText.textContent = original;
      }, 2000);
    });

    // Entity extraction — runs in result page lifecycle (no race condition)
    if (!result.entities && currentTranscript && currentConfig) {
      try {
        const outputLang = currentConfig.outputLanguage || 'English';
        const entities = await llmExtractEntities(currentConfig, currentTranscript, outputLang);
        if (entities && entities.length > 0) {
          const data = await browser.storage.local.get('yt_summary_result');
          if (data.yt_summary_result) {
            data.yt_summary_result.entities = entities;
            await browser.storage.local.set({ yt_summary_result: data.yt_summary_result });
            updateSummaryUI(data.yt_summary_result);
          }
        }
      } catch (err) {
        console.error("Entity extraction failed:", err.message);
      }
    }

    // Handle external storage updates (e.g. from another tab)
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.yt_summary_result) {
        const newVal = changes.yt_summary_result.newValue;
        if (newVal && newVal.entities && (!currentResult || !currentResult.entities)) {
           updateSummaryUI(newVal);
        }
      }
    });

  } catch (e) {
    document.getElementById('loading').replaceChildren();
    const errorMsg = document.createElement('div');
    errorMsg.className = 'loading-text';
    errorMsg.textContent = `Greška: ${e.message}`;
    document.getElementById('loading').appendChild(errorMsg);
  }
}

init();