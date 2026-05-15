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
  const wordCount = result.summary.split(/\s+/).length;
  document.getElementById('meta-words').textContent = `~${wordCount} reči`;

  setSafeHTML(document.getElementById('summary'), markdownToHtml(result.summary));

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

async function regenerateSummary(level) {
  if (!currentTranscript || !currentConfig) return;

  const buttons = document.querySelectorAll('.detail-btn');
  buttons.forEach(b => b.disabled = true);
  document.getElementById('summary').style.opacity = '0.5';

  try {
    const result = await llmSummarize(currentConfig, currentTranscript, level, "standard");

    const storageData = await browser.storage.local.get('yt_summary_result');
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
    document.getElementById('summary').style.opacity = '1';
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

    if (!result) {
      document.getElementById('loading').replaceChildren();
      const errorMsg = document.createElement('div');
      errorMsg.className = 'loading-text';
      errorMsg.textContent = 'Nema podataka za prikaz.';
      document.getElementById('loading').appendChild(errorMsg);
      return;
    }

    updateSummaryUI(result);

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

    // Copy buttons
    document.getElementById('copy-md-btn').addEventListener('click', async function() {
      const data = await browser.storage.local.get('yt_summary_result');
      await navigator.clipboard.writeText(data.yt_summary_result.summary);
      this.classList.add('copied');
      const btnText = this.querySelector('.btn-text');
      const original = btnText.textContent;
      btnText.textContent = '✓ Kopirano!';
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
      btnText.textContent = '✓ Kopirano!';
      setTimeout(() => {
        this.classList.remove('copied');
        btnText.textContent = original;
      }, 2000);
    });

    // Entity extraction — runs in result page lifecycle (no race condition)
    if (!result.entities && currentTranscript && currentConfig) {
      try {
        const entities = await llmExtractEntities(currentConfig, currentTranscript);
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