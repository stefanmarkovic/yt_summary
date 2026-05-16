document.addEventListener('DOMContentLoaded', async () => {
  if (typeof localizePage === 'function') {
    const data = await browser.storage.local.get('llm_config');
    localizePage(data.llm_config?.uiLanguage || 'en');
  }

  const storage = await browser.storage.local.get('batch_job');
  if (!storage.batch_job) {
    document.getElementById('progress-text').textContent = 'No batch job found.';
    return;
  }

  const { batch_job } = storage;
  const total = batch_job.videoIds.length;
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('batch-progress');
  const resultsContainer = document.getElementById('batch-results');

  for (let i = 0; i < total; i++) {
    const videoId = batch_job.videoIds[i];
    progressText.textContent = `Processing video ${i+1} of ${total}... (ID: ${videoId})`;
    progressBar.value = (i / total) * 100;

    let tab;
    try {
      tab = await browser.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false });
      
      // Wait for DOM and ytInitialData to settle
      await new Promise(r => setTimeout(r, 6000));

      const transcript = await getProcessedTranscript(tab.id, videoId);
      
      progressText.textContent = `Summarizing video ${i+1}...`;
      const result = await llmSummarizeLong(
        batch_job.llmConfig, 
        transcript.text, 
        batch_job.detail, 
        batch_job.persona, 
        transcript.chapters, 
        batch_job.outputLang
      );
      
      const div = document.createElement('div');
      div.className = 'summary info-card';
      div.style.display = 'block';
      div.style.marginBottom = '20px';
      
      let summaryText = result.text;
      const tldrMatch = summaryText.match(/TL;DR:\s*(.*?)(\n|$)/i);
      let tldrHtml = '';
      if (tldrMatch) {
        tldrHtml = `<div style="padding: 10px; background: rgba(255, 215, 0, 0.1); border-radius: 6px; margin-bottom: 10px;"><strong>TL;DR:</strong> ${tldrMatch[1]}</div>`;
        summaryText = summaryText.replace(tldrMatch[0], '').trim();
      }

      div.innerHTML = `
        <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 15px;">
          <h2 style="margin:0;"><a href="https://youtu.be/${videoId}" target="_blank" style="color: #818cf8; text-decoration: none;">Video ${i+1}</a></h2>
        </div>
        ${tldrHtml}
        ${markdownToHtml(summaryText)}
      `;
      resultsContainer.appendChild(div);

    } catch (err) {
      const div = document.createElement('div');
      div.className = 'summary info-card';
      div.style.display = 'block';
      div.style.marginBottom = '20px';
      div.innerHTML = `<h3 style="color: #ef4444;">Video ${i+1} Error</h3><p>${err.message}</p>`;
      resultsContainer.appendChild(div);
      console.error(`Batch video ${videoId} error:`, err);
    } finally {
      if (tab) {
        await browser.tabs.remove(tab.id);
      }
    }
  }

  progressBar.value = 100;
  progressText.textContent = `Finished processing ${total} videos.`;
  await browser.storage.local.remove('batch_job');
});