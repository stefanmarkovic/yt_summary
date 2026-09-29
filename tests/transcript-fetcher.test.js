const { fetchTranscriptInPageContext } = require('../transcript-fetcher.js');

describe('injected transcript fetcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="movie_player"></div>';
    document.getElementById('movie_player').getPlayerResponse = () => ({
      videoDetails: { videoId: 'video' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://captions.test/video' }] } }
    });
    delete window.ytInitialData;
    delete window.ytInitialPlayerResponse;
    delete window.ytcfg;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
    delete window.ytInitialData;
    delete window.ytInitialPlayerResponse;
    delete window.ytcfg;
  });

  function captionResponse(text) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/xml' }, text: async () => text });
  }

  test('parses XML attributes, markup and numeric entities through the actual injected function', async () => {
    captionResponse('<transcript><text dur="2" start="1.5">Hello <b>world</b> &amp; &#169; &#x1F600;</text></transcript>');
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({
      status: 'ok', segments: [{ text: 'Hello world & © 😀', startSec: 1.5, durSec: 2 }]
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('parses timed-text XML and captions shorter than the former 50 byte cutoff', async () => {
    captionResponse('<timedtext><body><p t="1500" d="2000"><s>Hello</s> world</p></body></timedtext>');
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({
      status: 'ok', segments: [{ text: 'Hello world', startSec: 1.5, durSec: 2 }]
    });
    captionResponse('<text start="0">Hi</text>');
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({ status: 'ok', segments: [{ text: 'Hi' }] });
  });

  test('ignores invalid JSON event times and non-text fragments', async () => {
    captionResponse(JSON.stringify({ events: [
      { tStartMs: 'bad', segs: [{ utf8: 'Invalid time' }] },
      { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'Valid' }, {}, { utf8: ' caption' }] }
    ] }));
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({
      status: 'ok', segments: [{ text: 'Valid caption', startSec: 1.5, durSec: 2 }]
    });
  });

  test('extracts chapter metadata from current page data and ignores invalid times', async () => {
    window.ytInitialData = {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'video' } },
      playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: {
        decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [{
          key: 'AUTO_CHAPTERS', value: { chapters: [
            { chapterRenderer: { title: { runs: [{ text: 'Chapter one' }] }, timeRangeStartMillis: '1500' } },
            { chapterRenderer: { title: { simpleText: 'Invalid' }, timeRangeStartMillis: 'bad' } }
          ] }
        }] } } }
      } } }
    };
    captionResponse('<text start="0">Hi</text>');
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({ chapters: [{ title: 'Chapter one', timeSec: 1.5 }] });
    window.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId = 'old-video';
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({ chapters: [] });
  });

  test('does not fetch stale player captions belonging to another video', async () => {
    document.getElementById('movie_player').getPlayerResponse = () => ({
      videoDetails: { videoId: 'old-video' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://captions.test/old' }] } }
    });
    global.fetch = jest.fn();
    const pending = fetchTranscriptInPageContext('video');
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: 'error' });
    expect(fetch).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('hung network requests have a deadline', async () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    const pending = fetchTranscriptInPageContext('video');
    await jest.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.debugLines).toContain('Transcript fetch timed out.');
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
