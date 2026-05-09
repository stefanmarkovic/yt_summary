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

function markdownToHtml(md) {
  let html = md;
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n\n+/g, '\n\n');
  html = html.split('\n\n').map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') ||
        block.startsWith('<blockquote') || block.startsWith('<hr') || block.startsWith('<li')) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

let chatHistory = [];
let currentTranscript = "";
let currentApiKey = "";

function updateSummaryUI(result) {
  document.getElementById('video-title').textContent = result.title || 'Video sažetak';
  document.title = `Sažetak: ${result.title || 'Video'}`;
  document.getElementById('meta-date').textContent = new Date(result.timestamp).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric' });
  const wordCount = result.summary.split(/\s+/).length;
  document.getElementById('meta-words').textContent = `~${wordCount} reči`;

  document.getElementById('summary').innerHTML = markdownToHtml(result.summary);

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

    sponsorContainer.innerHTML = html;
    sponsorContainer.style.display = 'block';
  } else {
    sponsorContainer.style.display = 'none';
  }

  // === Token / Cost info ===
  const usageContainer = document.getElementById('usage-info');
  if (result.usage) {
    const u = result.usage;
    usageContainer.innerHTML = `
      <div class="usage-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg>
        <span>gemini-3-flash-preview</span>
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
          <span class="usage-value usage-cost">~$${u.estimatedCost}</span>
        </div>
      </div>
      <div class="usage-note">Cene: $0.10/1M input · $0.40/1M output</div>
    `;
    usageContainer.style.display = 'block';
  } else {
    usageContainer.style.display = 'none';
  }
}

async function regenerateSummary(level) {
  if (!currentTranscript || !currentApiKey) return;
  
  const buttons = document.querySelectorAll('.detail-btn');
  buttons.forEach(b => b.disabled = true);
  document.getElementById('summary').style.opacity = '0.5';
  
  try {
    const detailPrompts = { "1": "Kratak rezime.", "2": "Srednji rezime sa buletima.", "3": "Veoma detaljan rezime." };
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${currentApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Transkript: ${currentTranscript}\n\nInstrukcija: ${detailPrompts[level]} na srpskom jeziku.` }] }]
        })
      }
    );
    const resultJson = await response.json();
    if (resultJson.error) throw new Error(resultJson.error.message);

    const summary = resultJson.candidates[0].content.parts[0].text;
    const meta = resultJson.usageMetadata || {};
    const promptTokens = meta.promptTokenCount || 0;
    const outputTokens = meta.candidatesTokenCount || 0;
    const totalTokens = meta.totalTokenCount || (promptTokens + outputTokens);
    const costInput = (promptTokens / 1_000_000) * 0.10;
    const costOutput = (outputTokens / 1_000_000) * 0.40;
    const estimatedCost = (costInput + costOutput).toFixed(6);

    const storageData = await browser.storage.local.get('yt_summary_result');
    const newResult = {
      ...storageData.yt_summary_result,
      summary,
      usage: { promptTokens, outputTokens, totalTokens, estimatedCost },
      timestamp: Date.now()
    };

    await browser.storage.local.set({ yt_summary_result: newResult });
    updateSummaryUI(newResult);
    
    // Update active button
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

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${role}`;
  msgDiv.innerHTML = markdownToHtml(text);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  const text = input.value.trim();
  
  if (!text || !currentTranscript || !currentApiKey) return;
  
  input.value = "";
  btn.disabled = true;
  appendChatMessage('user', text);
  
  try {
    // Konstruiši contents za Gemini. Prvi je uvek transkript.
    const contents = [
      { role: "user", parts: [{ text: `Ovo je transkript YouTube videa: ${currentTranscript}\n\nOdgovaraj na pitanja na osnovu ovog transkripta na srpskom jeziku.` }] },
      ...chatHistory,
      { role: "user", parts: [{ text: text }] }
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${currentApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      }
    );
    const resultJson = await response.json();
    if (resultJson.error) throw new Error(resultJson.error.message);

    const aiResponse = resultJson.candidates[0].content.parts[0].text;
    appendChatMessage('model', aiResponse);
    
    chatHistory.push({ role: "user", parts: [{ text: text }] });
    chatHistory.push({ role: "model", parts: [{ text: aiResponse }] });
    
  } catch (e) {
    appendChatMessage('model', "Greška: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  try {
    const localData = await browser.storage.local.get(['yt_summary_result', 'gemini_api_key']);
    const sessionData = await browser.storage.session.get('yt_transcript');
    
    const result = localData.yt_summary_result;
    currentApiKey = localData.gemini_api_key;
    currentTranscript = sessionData.yt_transcript;

    if (!result) {
      document.getElementById('loading').innerHTML = '<div class="loading-text">Nema podataka za prikaz.</div>';
      return;
    }

    updateSummaryUI(result);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('page').style.display = 'block';

    // Event Listeners for detail buttons
    document.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', () => regenerateSummary(btn.dataset.level));
    });

    // Chat Listeners
    document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // Copy buttons
    document.getElementById('copy-md-btn').addEventListener('click', async function() {
      const data = await browser.storage.local.get('yt_summary_result');
      await navigator.clipboard.writeText(data.yt_summary_result.summary);
      this.classList.add('copied');
      const originalHtml = this.innerHTML;
      this.innerHTML = this.innerHTML.replace('Kopiraj Markdown', '✓ Kopirano!');
      setTimeout(() => {
        this.classList.remove('copied');
        this.innerHTML = originalHtml;
      }, 2000);
    });

    document.getElementById('copy-text-btn').addEventListener('click', async function() {
      const data = await browser.storage.local.get('yt_summary_result');
      const plain = data.yt_summary_result.summary.replace(/[#*`>_\-]/g, '').replace(/\n{3,}/g, '\n\n');
      await navigator.clipboard.writeText(plain);
      this.classList.add('copied');
      const originalHtml = this.innerHTML;
      this.innerHTML = this.innerHTML.replace('Kopiraj tekst', '✓ Kopirano!');
      setTimeout(() => {
        this.classList.remove('copied');
        this.innerHTML = originalHtml;
      }, 2000);
    });
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div class="loading-text">Greška: ${e.message}</div>`;
  }
}

init();
