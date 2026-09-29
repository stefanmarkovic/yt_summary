const fs = require('fs');
const { getLocalizedString, localizePage } = require('../i18n.js');
const { markdownToHtml, setSafeHTML, escapeHtml } = require('../markdown-renderer.js');
const { renderSummaryCard } = require('../summary-renderer.js');

let store;
let resultPage;

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = fs.readFileSync(require('path').join(__dirname, '..', 'result.html'), 'utf8');
  window.history.replaceState({}, '', '?id=first');
  Object.assign(global, { getLocalizedString, localizePage, markdownToHtml, setSafeHTML, escapeHtml, renderSummaryCard });
  store = {
    yt_summary_result: { id: 'second', videoId: 'bbbbbbbbbbb', title: 'Latest video B', summary: 'B summary', timestamp: 2 },
    llm_config: { apiKey: 'key', provider: 'gemini', model: 'model', uiLanguage: 'en' },
    yt_result_first: {
      result: { id: 'first', videoId: 'aaaaaaaaaaa', title: 'Original video A', summary: 'A summary', timestamp: 1, chapters: [{ title: 'A chapter' }], persona: 'skeptic', outputLang: 'Srpski', entities: ['A entity'] },
      transcript: 'Transcript A'
    }
  };
  global.browser = {
    storage: {
      local: { get: jest.fn(async () => store), set: jest.fn(async value => Object.assign(store, value)) },
      session: { get: jest.fn(async () => store), set: jest.fn(async value => Object.assign(store, value)) }
    }
  };
  global.initChat = jest.fn();
  global.handleGenerateQuiz = jest.fn();
  global.llmExtractEntities = jest.fn().mockResolvedValue([]);
  global.llmSummarizeLong = jest.fn().mockResolvedValue({ text: 'Regenerated A', usage: {} });
  global.alert = jest.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } });
  resultPage = require('../result.js');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  jest.useRealTimers();
});

test('regenerating an older tab keeps its transcript, title, persona and chapters without overwriting latest video', async () => {
  await resultPage.init();
  expect(document.getElementById('video-title').textContent).toBe('Original video A');
  await resultPage.regenerateSummary('3');
  expect(llmSummarizeLong).toHaveBeenCalledWith(store.llm_config, 'Transcript A', '3', 'skeptic', [{ title: 'A chapter' }], 'Srpski');
  expect(store.yt_result_first.result.summary).toBe('Regenerated A');
  expect(store.yt_result_first.result.videoId).toBe('aaaaaaaaaaa');
  expect(store.yt_summary_result.videoId).toBe('bbbbbbbbbbb');
  expect(browser.storage.local.set).not.toHaveBeenCalled();
});

test('copy markdown uses the visible snapshot instead of the newest stored summary', async () => {
  jest.useFakeTimers();
  await resultPage.init();
  document.getElementById('copy-md-btn').click();
  await Promise.resolve();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('A summary');
  expect(document.getElementById('copy-md-btn').disabled).toBe(true);
  await jest.advanceTimersByTimeAsync(2000);
  expect(document.getElementById('copy-md-btn').disabled).toBe(false);
});

test('entity extraction writes back to the page snapshot while another video remains latest', async () => {
  delete store.yt_result_first.result.entities;
  llmExtractEntities.mockResolvedValue(['Entity A']);
  await resultPage.init();
  expect(store.yt_result_first.result.entities).toEqual(['Entity A']);
  expect(store.yt_summary_result.entities).toBeUndefined();
  expect(document.getElementById('video-title').textContent).toBe('Original video A');
});

test('missing snapshot reports no data instead of showing an unrelated video', async () => {
  delete store.yt_result_first;
  await resultPage.init();
  expect(document.getElementById('loading').textContent).toBe('No data to display.');
  expect(document.getElementById('page').style.display).toBe('none');
});

test('regeneration updates the latest local result only when its analysis ID still matches', async () => {
  store.yt_summary_result = { ...store.yt_result_first.result };
  await resultPage.init();
  await resultPage.regenerateSummary('1');
  expect(store.yt_summary_result.summary).toBe('Regenerated A');
  expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
});

test('another analysis of the same video keeps its own latest result', async () => {
  store.yt_summary_result.videoId = 'aaaaaaaaaaa';
  await resultPage.init();
  await resultPage.regenerateSummary('1');
  expect(store.yt_summary_result.summary).toBe('B summary');
  expect(browser.storage.local.set).not.toHaveBeenCalled();
});

test('legacy summary can be read but mismatched legacy transcript actions stay disabled', async () => {
  window.history.replaceState({}, '', '/');
  store.yt_transcript = 'Unrelated legacy transcript';
  await resultPage.init();
  expect(document.getElementById('video-title').textContent).toBe('Latest video B');
  expect(document.getElementById('generate-quiz-btn').disabled).toBe(true);
  expect(document.getElementById('download-transcript-btn').disabled).toBe(true);
  expect(document.getElementById('detail-short').disabled).toBe(true);
  expect(llmExtractEntities).not.toHaveBeenCalled();
});
