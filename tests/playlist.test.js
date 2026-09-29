const fs = require('fs');
const { initializePlaylist } = require('../playlist.js');
const { getLocalizedString, localizePage } = require('../i18n.js');

let session;
beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = fs.readFileSync(require('path').join(__dirname, '..', 'playlist.html'), 'utf8');
  window.history.replaceState({}, '', '?id=job-a');
  Object.assign(global, { getLocalizedString, localizePage });
  session = { 'yt_batch_job-a': { videoIds: ['abcdefghijk'], llmConfig: { apiKey: 'key', uiLanguage: 'en' }, detail: '2', persona: 'standard', outputLang: 'English' } };
  global.browser = {
    storage: {
      local: { get: jest.fn().mockResolvedValue({ llm_config: { uiLanguage: 'en' }, batch_job: { videoIds: ['unrelated'] } }), set: jest.fn().mockResolvedValue(undefined) },
      session: { get: jest.fn(async key => ({ [key]: session[key] })), remove: jest.fn().mockResolvedValue(undefined) }
    },
    windows: { create: jest.fn().mockResolvedValue({ id: 7 }), remove: jest.fn().mockResolvedValue(undefined) },
    tabs: { query: jest.fn().mockResolvedValue([{ id: 42 }]), get: jest.fn().mockResolvedValue({ title: 'Video A - YouTube' }) }
  };
  global.fetch = jest.fn().mockRejectedValue(new Error('Direct fetch unavailable'));
  global.getSponsorSegments = jest.fn().mockResolvedValue([]);
  global.getProcessedTranscript = jest.fn().mockResolvedValue({ text: 'Transcript A', savedSeconds: 0, categoryStats: {}, chapters: [], debugLines: [] });
  global.llmSummarizeLong = jest.fn().mockResolvedValue({ text: 'Summary A', usage: {} });
  global.renderSummaryCard = jest.fn();
});
afterEach(() => { jest.useRealTimers(); window.history.replaceState({}, '', '/'); });

test('playlist processes its session job and cleans fallback windows before generating the summary', async () => {
  const run = initializePlaylist();
  await jest.advanceTimersByTimeAsync(6000);
  await run;
  expect(browser.storage.session.get).toHaveBeenCalledWith('yt_batch_job-a');
  expect(getProcessedTranscript).toHaveBeenCalledWith(42, 'abcdefghijk');
  expect(browser.windows.remove).toHaveBeenCalledWith(7);
  expect(llmSummarizeLong).toHaveBeenCalledWith(session['yt_batch_job-a'].llmConfig, 'Transcript A', '2', 'standard', [], 'English');
  expect(browser.storage.session.remove).toHaveBeenCalledWith('yt_batch_job-a');
  expect(document.getElementById('batch-progress').value).toBe(100);
  expect(document.getElementById('batch-results').textContent).toContain('Video A');
});

test('fallback transcript failure still closes its window and avoids an LLM call', async () => {
  getProcessedTranscript.mockRejectedValue(new Error('No transcript'));
  const run = initializePlaylist();
  await jest.advanceTimersByTimeAsync(6000);
  await run;
  expect(browser.windows.remove).toHaveBeenCalledWith(7);
  expect(llmSummarizeLong).not.toHaveBeenCalled();
  expect(document.getElementById('batch-results').textContent).toContain('No transcript');
  expect(browser.storage.session.remove).toHaveBeenCalledWith('yt_batch_job-a');
});

test('missing session job never starts the unrelated legacy local job', async () => {
  session = {};
  await initializePlaylist();
  expect(fetch).not.toHaveBeenCalled();
  expect(browser.windows.create).not.toHaveBeenCalled();
  expect(document.getElementById('progress-text').textContent).toBe('No batch job found.');
});
