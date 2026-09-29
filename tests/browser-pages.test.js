/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const config = {
  provider: 'gemini',
  model: 'gemini-3.7-flash',
  url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  apiKey: 'fixture-key',
  uiLanguage: 'en',
  outputLanguage: 'English',
  contextWindow: 32768,
  temperature: 0.7,
  topP: 1
};

function storageArea(values) {
  return {
    get: jest.fn(async keys => Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, values[key]])
    )),
    set: jest.fn(async updates => { Object.assign(values, updates); }),
    remove: jest.fn(async key => { delete values[key]; })
  };
}

describe('extension pages with their actual browser script order', () => {
  let dom;
  let fetchMock;

  async function openPage(filename) {
    dom = new JSDOM(fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8'), {
      url: `https://extension.test/${filename}?id=fixture`,
      runScripts: 'outside-only'
    });
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    fetchMock = jest.fn(() => Promise.reject(new Error('Unexpected network request during page startup.')));
    const result = {
      title: 'Fixture video', videoId: 'Wno_JVqhnqI', videoUrl: 'https://www.youtube.com/watch?v=Wno_JVqhnqI',
      summary: 'TL;DR: Fixture overview.\n\nA useful summary.', entities: [], timestamp: 1,
      model: config.model, detail: '2'
    };
    Object.assign(dom.window, {
      fetch: fetchMock,
      AbortController,
      browser: {
        runtime: { getManifest: () => ({ version: '4.4.1' }), getURL: file => `https://extension.test/${file}` },
        storage: {
          local: storageArea({ llm_config: config, yt_summary_result: result }),
          session: storageArea({ yt_result_fixture: { result, transcript: '[0:00] Fixture transcript.' } }),
          onChanged: { addListener: jest.fn() }
        },
        tabs: { query: jest.fn(async () => [{ id: 1, url: result.videoUrl }]), create: jest.fn() }
      }
    });
    dom.window.console.log = jest.fn();
    const context = dom.getInternalVMContext();
    for (const script of dom.window.document.querySelectorAll('script[src]')) {
      const source = script.getAttribute('src');
      vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', source), 'utf8'), context, { filename: source });
    }
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    // Drain the startup storage reads and DOM updates without real network or timers.
    await new Promise(resolve => setImmediate(resolve));
    return dom.window.document;
  }

  afterEach(() => { dom?.window.close(); });

  test('popup initializes and opens settings with browser globals, without CommonJS exports', async () => {
    const document = await openPage('popup.html');
    expect(document.getElementById('plugin-version').textContent).toBe('v4.4.1');
    document.getElementById('settings-btn').click();
    expect(document.getElementById('setup-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-model-input').value).toBe(config.model);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('result loads its snapshot and renders with the actual shared scripts', async () => {
    const document = await openPage('result.html');
    expect(document.getElementById('video-title').textContent).toBe('Fixture video');
    expect(document.querySelector('#summary .summary-body').textContent).toContain('A useful summary.');
    expect(document.getElementById('download-transcript-btn').disabled).toBe(false);
    expect(document.getElementById('page').style.display).toBe('block');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('playlist without a job displays an empty state and makes no API requests', async () => {
    const document = await openPage('playlist.html');
    expect(document.getElementById('progress-text').textContent).toMatch(/No batch job/i);
    expect(document.getElementById('batch-results').children).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
