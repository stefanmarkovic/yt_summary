const { fetchTranscriptInPageContext } = require('../transcript-fetcher.js');

describe('transcript fast-path selection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="movie_player"></div><ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>';
    document.getElementById('movie_player').getPlayerResponse = () => ({
      videoDetails: { videoId: 'video' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://captions.test/video' }] } }
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('a caption result wins before DOM scraping starts, so the page is never clicked', async () => {
    const transcriptButton = document.querySelector('button');
    const click = jest.spyOn(transcriptButton, 'click');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ events: [{ segs: [{ utf8: 'Fast caption' }] }] })
    });
    const result = await fetchTranscriptInPageContext('video');
    expect(result.status).toBe('ok');
    expect(result.segments[0].text).toBe('Fast caption');
    expect(result.debugLines).toContainEqual(expect.stringMatching(/^\+\d+ms Transcript winner: M1$/));
    expect(result.debugLines.some(line => line.includes('M2: DOM scraping'))).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('empty captions start DOM scraping at once, and the description button is clicked without a fixed pause', async () => {
    const expand = document.createElement('tp-yt-paper-button');
    expand.id = 'expand';
    Object.defineProperty(expand, 'offsetParent', { get: () => document.body });
    document.body.prepend(expand);
    const expandClick = jest.spyOn(expand, 'click');
    const transcriptClick = jest.spyOn(document.querySelector('button'), 'click');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => ''
    });
    const pending = fetchTranscriptInPageContext('video');
    await jest.advanceTimersByTimeAsync(10);
    expect(expandClick).toHaveBeenCalled();
    expect(transcriptClick).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(8000);
    await pending;
  });

  test('every page debug line carries its elapsed time for speed analysis', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'text/xml' }, text: async () => ''
    });
    const pending = fetchTranscriptInPageContext('video');
    await jest.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.debugLines.length).toBeGreaterThan(3);
    expect(result.debugLines.every(line => /^\+\d+ms /.test(line))).toBe(true);
    expect(result.debugLines).toContainEqual(expect.stringMatching(/M1: finished without segments$/));
  });
});
