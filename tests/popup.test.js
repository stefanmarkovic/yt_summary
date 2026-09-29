const fs = require('fs');
const path = require('path');
const { LLM_PROVIDERS, normalizeLlmConfig } = require('../gemini.js');
const { getLocalizedString, localizePage } = require('../i18n.js');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Popup UI interactions', () => {
  let initializePopup;
  let getYoutubeVideoId;
  let store;
  beforeEach(async () => {
    document.body.innerHTML = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
    store = { llm_config: { apiKey: '123', provider: 'gemini', temperature: 0, topP: 0 } };
    global.browser = {
      runtime: { getManifest: () => ({ version: 'test' }), getURL: file => `moz-extension://test/${file}` },
      storage: {
        local: { get: jest.fn(async () => store), set: jest.fn(async value => { Object.assign(store, value); }) },
        session: { set: jest.fn().mockResolvedValue({}) }
      },
      tabs: { query: jest.fn().mockResolvedValue([{ id: 1, url: 'https://youtube.com/watch?v=abcdefghijk', title: 'Test - YouTube' }]), create: jest.fn().mockResolvedValue({}) },
      scripting: { executeScript: jest.fn().mockRejectedValue(new Error('Permission denied')) }
    };
    global.LLM_PROVIDERS = LLM_PROVIDERS;
    global.normalizeLlmConfig = normalizeLlmConfig;
    global.getLocalizedString = getLocalizedString;
    global.localizePage = localizePage;
    ({ initializePopup, getYoutubeVideoId } = require('../popup.js'));
    await initializePopup();
  });

  test('settings and close buttons toggle views after real async initialization', () => {
    document.getElementById('settings-btn').click();
    expect(document.getElementById('setup-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('main-view').classList.contains('hidden')).toBe(true);
    document.getElementById('cancel-btn').click();
    expect(document.getElementById('main-view').classList.contains('hidden')).toBe(false);
  });

  test('provider changes update endpoint and editable model together', () => {
    const select = document.getElementById('llm-provider');
    select.value = 'openrouter';
    select.dispatchEvent(new Event('change'));
    expect(document.getElementById('api-url-input').value).toBe(LLM_PROVIDERS.openrouter.url);
    expect(document.getElementById('api-model-input').value).toBe(LLM_PROVIDERS.openrouter.defaultModel);
    expect(document.getElementById('api-model-input').readOnly).toBe(false);
    expect(document.getElementById('gemini-model-wrapper').classList.contains('hidden')).toBe(true);
  });

  test('saving retains valid zero sampling values', async () => {
    expect(document.getElementById('temperature-input').value).toBe('0');
    expect(document.getElementById('top-p-input').value).toBe('0');
    document.getElementById('save-key-btn').click();
    await flush();
    expect(store.llm_config.temperature).toBe(0);
    expect(store.llm_config.topP).toBe(0);
  });

  test.each([
    ['https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk'],
    ['https://youtu.be/abcdefghijk?t=2', 'abcdefghijk'],
    ['https://youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
    ['https://evil.com/watch?v=abcdefghijk', null],
    ['https://notyoutube.com/watch?v=abcdefghijk', null],
    ['https://youtube.com/watch?v=short', null],
    ['javascript:abcdefghijk', null],
    [undefined, null]
  ])('extracts only valid YouTube IDs from %s', (url, expected) => {
    expect(getYoutubeVideoId(url)).toBe(expected);
  });

  test('playlist extraction failure re-enables the button and exposes the error', async () => {
    document.getElementById('playlist-summarize-btn').click();
    await flush();
    expect(document.getElementById('playlist-summarize-btn').disabled).toBe(false);
    expect(document.getElementById('status').textContent).toContain('Permission denied');
  });

  test('analysis rejects non-YouTube tabs before fetching a transcript', async () => {
    global.getProcessedTranscript = jest.fn();
    browser.tabs.query.mockResolvedValue([{ id: 1, url: 'https://evil.com/watch?v=abcdefghijk' }]);
    document.getElementById('summarize-btn').click();
    await flush();
    expect(getProcessedTranscript).not.toHaveBeenCalled();
    expect(document.getElementById('summarize-btn').disabled).toBe(false);
    expect(document.getElementById('status').textContent).toContain('YouTube');
  });

  test('analysis opens an isolated result snapshot with the matching transcript and persona', async () => {
    global.getProcessedTranscript = jest.fn().mockResolvedValue({ text: 'Transcript A', debugLines: [], categoryStats: {}, chapters: [], segmentCount: 1, sponsorCount: 0, savedSeconds: 0 });
    global.PERSONA_PROMPTS = { standard: 'Standard' };
    global.resolvePersona = jest.fn(value => value);
    global.llmSummarizeLong = jest.fn().mockResolvedValue({ text: 'Summary A', usage: { promptTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCost: '0' } });
    document.getElementById('summarize-btn').click();
    await flush();
    const snapshotWrite = browser.storage.session.set.mock.calls[0][0];
    const [key] = Object.keys(snapshotWrite);
    expect(key).toMatch(/^yt_result_/);
    expect(snapshotWrite[key]).toMatchObject({ result: { videoId: 'abcdefghijk', summary: 'Summary A', persona: 'standard', detail: '2' }, transcript: 'Transcript A' });
    expect(snapshotWrite[key].result.apiKey).toBeUndefined();
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: `moz-extension://test/result.html?id=${snapshotWrite[key].result.id}` });
  });
});
