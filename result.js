// result.js — Thin orchestrator: wires modules, manages UI state
// Rendering delegated to summary-renderer.js

function downloadAsFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyWithFeedback(button, text) {
  navigator.clipboard.writeText(text).then(() => {
    button.classList.add('copied');
    const btnText = button.querySelector('.btn-text');
    const original = btnText.textContent;
    btnText.textContent = '\u2713 Copied!';
    setTimeout(() => {
      button.classList.remove('copied');
      btnText.textContent = original;
    }, 2000);
  });
}

let currentTranscript = "";
let currentConfig = null;
let currentResult = null;

function updateSummaryUI(result) {
  currentResult = result;
  document.getElementById('video-title').textContent = result.title || 'Video sa\u017eetak';
  document.title = `Sa\u017eetak: ${result.title || 'Video'}`;
  document.getElementById('meta-date').textContent = new Date(result.timestamp).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric' });

  // Delegate rendering to summary-renderer.js
  const summaryContainer = document.getElementById('summary');
  const renderResult = renderSummaryCard(summaryContainer, result, currentConfig);

  document.getElementById('meta-words').textContent = `~${renderResult.wordCount} words (${renderResult.readTime} min read)`;

  // TL;DR in dedicated page-level container
  if (renderResult.tldr) {
    document.getElementById('tldr-text').textContent = renderResult.tldr;
    document.getElementById('tldr-container').style.display = 'block';
  } else {
    document.getElementById('tldr-container').style.display = 'none';
  }

  // Hide standalone containers since rendering is now inside #summary
  document.getElementById('entity-info').style.display = 'none';
  document.getElementById('sponsor-info').style.display = 'none';
  document.getElementById('usage-info').style.display = 'none';
}

function generateWordCloud(transcript) {
  const container = document.getElementById('word-cloud-container');
  if (!transcript) {
    container.style.display = 'none';
    return;
  }
  
  const stopWords = new Set(['i', 'a', 'da', 'u', 'je', 'se', 'na', 'to', 'od', 'za', 'ne', 'kao', '\u0161to', 'koji', 'sa', 'ili', 'su', 'samo', 'iz', 'kako', 'ali', 'sve', 'ovo', 'the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'it', 'for', 'on', 'with', 'as', 'this', 'was', 'at', 'by', 'an', 'be', 'from', 'or', 'are', 'you']);
  
  const words = transcript.toLowerCase().replace(/[^\w\u0107\u010d\u0161\u017e\u0111]+/g, ' ').split(/\s+/);
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
    alert("Gre\u0161ka pri regeneraciji: " + e.message);
  } finally {
    buttons.forEach(b => b.disabled = false);
    summaryEl.style.opacity = '1';
  }
}

function handleDownloadTranscript() {
  if (!currentTranscript) return;
  downloadAsFile(currentTranscript, `transcript-${currentResult?.videoId || 'video'}.txt`, 'text/plain');
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
      const safeTitle = (currentResult?.title || 'Summary').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;line-height:1.6;color:#333;}</style>
</head>
<body>
<h1>${safeTitle}</h1>
${markdownToHtml(currentResult?.summary || '')}
</body></html>`;
      downloadAsFile(htmlContent, `summary-${currentResult?.videoId || 'video'}.html`, 'text/html');
    });

    document.getElementById('export-pdf-btn').addEventListener('click', () => {
      window.print();
    });

    document.getElementById('export-notion-btn').addEventListener('click', () => {
      const mdContent = `# ${currentResult?.title || 'Summary'}\n\n${currentResult?.summary || ''}`;
      downloadAsFile(mdContent, `summary-${currentResult?.videoId || 'video'}.md`, 'text/markdown');
    });

    // Copy buttons
    document.getElementById('copy-md-btn').addEventListener('click', async function() {
      const data = await browser.storage.local.get('yt_summary_result');
      copyWithFeedback(this, data.yt_summary_result.summary);
    });

    document.getElementById('copy-text-btn').addEventListener('click', async function() {
      const tempDiv = document.createElement('div');
      setSafeHTML(tempDiv, document.getElementById('summary').innerHTML);
      const plain = tempDiv.textContent.replace(/\n{3,}/g, '\n\n');
      copyWithFeedback(this, plain);
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
    errorMsg.textContent = `Gre\u0161ka: ${e.message}`;
    document.getElementById('loading').appendChild(errorMsg);
  }
}

init();