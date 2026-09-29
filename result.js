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

async function copyWithFeedback(button, text) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    button.classList.add('copied');
    const btnText = button.querySelector('.btn-text');
    const original = btnText.textContent;
    btnText.textContent = getLocalizedString('btn_copied', currentConfig?.uiLanguage || 'en');
    setTimeout(() => {
      button.classList.remove('copied');
      btnText.textContent = original;
      button.disabled = false;
    }, 2000);
  } catch (error) {
    button.disabled = false;
    alert(getLocalizedString('copy_error', currentConfig?.uiLanguage || 'en') + error.message);
  }
}

let currentTranscript = "";
let currentConfig = null;
let currentResult = null;
let resultStorageKey = null;

async function saveCurrentResult(result) {
  if (resultStorageKey) {
    await browser.storage.session.set({ [resultStorageKey]: { result, transcript: currentTranscript } });
  }
  const latest = await browser.storage.local.get('yt_summary_result');
  if (result.id && latest.yt_summary_result?.id === result.id) {
    await browser.storage.local.set({ yt_summary_result: result });
  }
}

function updateSummaryUI(result) {
  currentResult = result;
  const lang = currentConfig?.uiLanguage || 'en';
  document.getElementById('video-title').textContent = result.title || getLocalizedString('result_title', lang);
  document.title = `${getLocalizedString('result_title', lang)}: ${result.title || 'Video'}`;
  document.getElementById('meta-date').textContent = new Date(result.timestamp).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });

  // Delegate rendering to summary-renderer.js
  const summaryContainer = document.getElementById('summary');
  const renderResult = renderSummaryCard(summaryContainer, result, { ...currentConfig, model: result.model || currentConfig?.model });

  document.getElementById('meta-words').textContent = getLocalizedString('reading_stats', lang)
    .replace('{words}', renderResult.wordCount).replace('{minutes}', renderResult.readTime);
  document.querySelectorAll('.detail-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.level === (result.detail || '2'));
  });
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
  if (!currentTranscript || !currentConfig || document.querySelector('.detail-btn:disabled')) return;

  const buttons = document.querySelectorAll('.detail-btn');
  buttons.forEach(b => b.disabled = true);
  const summaryEl = document.getElementById('summary');
  summaryEl.style.opacity = '0.5';

  try {
    const sourceResult = currentResult;
    const chapters = sourceResult.chapters || [];
    
    // Za regeneraciju koristimo istu llmSummarizeLong logiku
    const outputLang = sourceResult.outputLang || currentConfig.outputLanguage || 'English';
    const result = await llmSummarizeLong(currentConfig, currentTranscript, level, sourceResult.persona || 'standard', chapters, outputLang);

    const newResult = {
      ...sourceResult,
      summary: result.text,
      usage: result.usage,
      model: currentConfig.model,
      detail: level,
      timestamp: Date.now()
    };

    await saveCurrentResult(newResult);
    updateSummaryUI(newResult);

    buttons.forEach(b => {
      b.classList.remove('active');
      if (b.dataset.level === level) b.classList.add('active');
    });

  } catch (e) {
    alert(getLocalizedString('regenerate_error', currentConfig?.uiLanguage || 'en') + e.message);
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
    const resultId = new URLSearchParams(window.location.search).get('id');
    resultStorageKey = resultId ? `yt_result_${resultId}` : null;
    const sessionData = await browser.storage.session.get(resultStorageKey || 'yt_transcript');
    const snapshot = resultStorageKey ? sessionData[resultStorageKey] : null;
    const result = resultStorageKey ? snapshot?.result : localData.yt_summary_result;
    currentConfig = localData.llm_config;
    // Legacy pages have no reliable association between transcript and summary.
    currentTranscript = snapshot?.transcript || '';

    if (currentConfig && typeof localizePage === 'function') {
      localizePage(currentConfig.uiLanguage || 'en');
    }

    if (!result) {
      document.getElementById('loading').replaceChildren();
      const errorMsg = document.createElement('div');
      errorMsg.className = 'loading-text';
      errorMsg.textContent = getLocalizedString('no_result', currentConfig?.uiLanguage || 'en');
      document.getElementById('loading').appendChild(errorMsg);
      return;
    }

    updateSummaryUI(result);
    generateWordCloud(currentTranscript);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('page').style.display = 'block';
    document.querySelectorAll('.detail-btn').forEach(button => { button.disabled = !currentTranscript || !currentConfig; });
    document.getElementById('generate-quiz-btn').disabled = !currentTranscript || !currentConfig;
    document.getElementById('download-transcript-btn').disabled = !currentTranscript;

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
    document.getElementById('copy-md-btn').addEventListener('click', function() {
      copyWithFeedback(this, currentResult.summary);
    });

    document.getElementById('copy-text-btn').addEventListener('click', async function() {
      const tempDiv = document.createElement('div');
      setSafeHTML(tempDiv, markdownToHtml(currentResult.summary));
      tempDiv.querySelectorAll('p,li,h1,h2,h3,blockquote,pre').forEach(node => {
        node.appendChild(document.createTextNode('\n'));
      });
      tempDiv.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
      const plain = tempDiv.textContent.replace(/\n{3,}/g, '\n\n').trim();
      copyWithFeedback(this, plain);
    });

    // Entity extraction — runs in result page lifecycle (no race condition)
    if (!result.entities && currentTranscript && currentConfig) {
      try {
        const outputLang = currentConfig.outputLanguage || 'English';
        const entities = await llmExtractEntities(currentConfig, currentTranscript, outputLang);
        if (entities && entities.length > 0) {
          const updatedResult = { ...currentResult, entities };
          await saveCurrentResult(updatedResult);
          updateSummaryUI(updatedResult);
        }
      } catch (err) {
        console.error("Entity extraction failed:", err.message);
      }
    }

    // Učitaj perzistentne logove iz skladišta
    const debugData = await browser.storage.local.get('yt_debug_logs');
    if (debugData.yt_debug_logs) {
      const debugContainer = document.getElementById('debug-section');
      const debugTextArea = document.getElementById('result-debug-log');
      if (debugContainer && debugTextArea) {
        debugTextArea.value = debugData.yt_debug_logs;
        debugContainer.style.display = 'block';
      }
    }

  } catch (e) {
    document.getElementById('loading').replaceChildren();
    const errorMsg = document.createElement('div');
    errorMsg.className = 'loading-text';
    errorMsg.textContent = getLocalizedString('status_error', currentConfig?.uiLanguage || 'en') + e.message;
    document.getElementById('loading').appendChild(errorMsg);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { init, regenerateSummary, copyWithFeedback, generateWordCloud };
} else {
  init();
}
