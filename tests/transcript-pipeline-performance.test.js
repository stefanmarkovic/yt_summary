const { getProcessedTranscript } = require('../transcript-pipeline.js');

function transcriptScriptResult() {
  return [{
    result: {
      status: 'ok',
      segments: [
        { text: 'First segment', startSec: 0, durSec: 2 },
        { text: 'Second segment', startSec: 2, durSec: 2 }
      ],
      chapters: [],
      debugLines: ['fixture transcript ready']
    }
  }];
}

describe('processed transcript latency', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    let cachedTranscript;
    global.fetchTranscriptInPageContext = jest.fn();
    global.browser = {
      scripting: {
        executeScript: jest.fn().mockResolvedValue(transcriptScriptResult())
      },
      storage: {
        session: {
          get: jest.fn().mockImplementation(async () => (
            cachedTranscript ? { yt_transcript_cache: cachedTranscript } : {}
          )),
          set: jest.fn().mockImplementation(async value => {
            cachedTranscript = value.yt_transcript_cache;
          })
        }
      }
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.browser;
    delete global.fetchTranscriptInPageContext;
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('SponsorBlock outage has a short best-effort deadline', async () => {
    global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = getProcessedTranscript(7, 'Wno_JVqhnqI');
    await jest.advanceTimersByTimeAsync(350);
    const result = await pending;

    expect(result.text).toContain('First segment');
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('reuses the last transcript for the same video', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    });

    const first = await getProcessedTranscript(7, 'Wno_JVqhnqI');
    const second = await getProcessedTranscript(7, 'Wno_JVqhnqI');

    expect(second.text).toBe(first.text);
    expect(second.debugLines).toContain('Transcript cache hit');
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
});
