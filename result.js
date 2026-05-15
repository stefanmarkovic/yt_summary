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
  // Sanitizacija: escape HTML pre markdown transformacija
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\d+\. (.+)$/gm, '<OLI>$1</OLI>');
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/((<OLI>.*<\/OLI>\n?)+)/g, (match) =>
    '<ol>' + match.replace(/OLI/g, 'li') + '</ol>');
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

  // Timestamps [MM:SS] -> clickable links
  html = html.replace(/\[(\d{1,3}):(\d{2})\]/g, '<a href="#" class="timestamp-link" data-time="$1:$2">[$1:$2]</a>');
  
  return html;
}

let chatHistory = [];
let currentTranscript = "";
let currentConfig = null;
let currentResult = null;

function setSafeHTML(element, htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  element.replaceChildren(...doc.body.childNodes);
}

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
          <span class="usage-value usage-cost">~$${u.estimatedCost}</span>
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

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${role}`;
  setSafeHTML(msgDiv, markdownToHtml(text));
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  const text = input.value.trim();
  
  if (!text || !currentTranscript || !currentConfig) return;
  
  input.value = "";
  btn.disabled = true;
  appendChatMessage('user', text);
  
  try {
    const result = await llmChat(currentConfig, currentTranscript, chatHistory, text);
    appendChatMessage('model', result.text);
    
    chatHistory.push({ role: "user", parts: [{ text: text }] });
    chatHistory.push({ role: "model", parts: [{ text: result.text }] });
    
  } catch (e) {
    appendChatMessage('model', "Greška: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleGenerateQuiz() {
  if (!currentTranscript || !currentConfig) return;
  const btn = document.getElementById('generate-quiz-btn');
  btn.disabled = true;
  btn.textContent = "Generisanje...";

  try {
    const result = await llmQuiz(currentConfig, currentTranscript);
    let jsonText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const questions = JSON.parse(jsonText);
    
    const container = document.getElementById('chat-messages');
    const quizDiv = document.createElement('div');
    quizDiv.className = `message message-model quiz-container`;
    quizDiv.style.cssText = "background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);";
    
    let html = `<h3 style="margin-top:0; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">Kviz znanja</h3>`;
    
    questions.forEach((q, qIndex) => {
      html += `<div class="quiz-question" style="margin-bottom: 15px;">
        <p style="font-weight: bold; margin-bottom: 8px;">${qIndex + 1}. ${q.question}</p>`;
      q.options.forEach((opt, oIndex) => {
        html += `<label style="display:block; margin-bottom: 4px; font-size: 13px; cursor: pointer;">
          <input type="radio" name="q${qIndex}" value="${oIndex}"> ${opt}
        </label>`;
      });
      html += `</div>`;
    });
    
    html += `<button id="submit-quiz-btn" class="secondary" style="margin-top: 10px;">Proveri odgovore</button>`;
    
    setSafeHTML(quizDiv, html);
    container.appendChild(quizDiv);
    container.scrollTop = container.scrollHeight;

    // Check answers listener
    quizDiv.querySelector('#submit-quiz-btn').addEventListener('click', (e) => {
      let score = 0;
      questions.forEach((q, qIndex) => {
        const selected = quizDiv.querySelector(`input[name="q${qIndex}"]:checked`);
        const qDiv = quizDiv.querySelectorAll('.quiz-question')[qIndex];
        
        if (selected) {
          const sIndex = parseInt(selected.value);
          if (sIndex === q.answerIndex) {
            score++;
            selected.parentElement.style.color = "#4ade80"; // green
          } else {
            selected.parentElement.style.color = "#f87171"; // red
            // Highlight correct one
            qDiv.querySelectorAll('label')[q.answerIndex].style.color = "#4ade80";
          }
        } else {
          qDiv.querySelectorAll('label')[q.answerIndex].style.color = "#4ade80";
        }
      });
      e.target.textContent = `Rezultat: ${score}/${questions.length}`;
      e.target.disabled = true;
    });

  } catch (e) {
    appendChatMessage('model', "Greška pri generisanju kviza: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🎲 Generiši kviz";
  }
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

    document.getElementById('generate-quiz-btn').addEventListener('click', handleGenerateQuiz);
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

    // Handle delayed Entity Extraction update (since it happens in background)
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