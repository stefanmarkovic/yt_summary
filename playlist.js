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
      
      // Video header
      const header = document.createElement('div');
      header.style.cssText = 'border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 15px;';
      const h2 = document.createElement('h2');
      h2.style.margin = '0';
      const link = document.createElement('a');
      link.href = `https://youtu.be/${videoId}`;
      link.target = '_blank';
      link.style.cssText = 'color: #818cf8; text-decoration: none;';
      link.textContent = `Video ${i+1}`;
      h2.appendChild(link);
      header.appendChild(h2);
      div.appendChild(header);

      // Delegate rendering to shared summary-renderer.js
      const contentDiv = document.createElement('div');
      div.appendChild(contentDiv);
      renderSummaryCard(contentDiv, {
        summary: result.text,
        title: `Video ${i + 1}`,
        videoId,
        videoUrl: `https://youtu.be/${videoId}`,
        sponsorSaved: transcript.savedSeconds,
        categoryStats: transcript.categoryStats,
        usage: result.usage
      }, batch_job.llmConfig);

      resultsContainer.appendChild(div);

    } catch (err) {
      const div = document.createElement('div');
      div.className = 'summary info-card';
      div.style.display = 'block';
      div.style.marginBottom = '20px';
      const errH3 = document.createElement('h3');
      errH3.style.color = '#ef4444';
      errH3.textContent = `Video ${i+1} Error`;
      const errP = document.createElement('p');
      errP.textContent = err.message;
      div.appendChild(errH3);
      div.appendChild(errP);
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