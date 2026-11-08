const { fetchTranscriptInPageContext } = require('../transcript-fetcher.js');

const segment = (time, text) => `<ytd-transcript-segment-renderer><div class="segment-timestamp">${time}</div><yt-formatted-string class="segment-text">${text}</yt-formatted-string></ytd-transcript-segment-renderer>`;

describe('injected transcript fetcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="movie_player"></div>';
    document.getElementById('movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: 'video' } });
    global.fetch = jest.fn();
    delete window.ytInitialData;
    delete window.ytInitialPlayerResponse;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
    delete window.ytInitialData;
    delete window.ytInitialPlayerResponse;
  });

  test('reads an already open transcript panel with timestamps, and never touches the network', async () => {
    document.body.insertAdjacentHTML('beforeend', segment('0:01', 'Hello &amp; welcome') + segment('1:02:03', 'Later'));
    const result = await fetchTranscriptInPageContext('video');
    expect(result).toMatchObject({
      status: 'ok',
      segments: [{ text: 'Hello & welcome', startSec: 1, durSec: 3722 }, { text: 'Later', startSec: 3723 }]
    });
    expect(result.debugLines).toContainEqual(expect.stringMatching(/^\+\d+ms Transcript panel: already open, 2 segments$/));
    expect(fetch).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('opens the panel through "Show transcript" in the description', async () => {
    document.body.insertAdjacentHTML('beforeend', '<ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>');
    document.querySelector('button').addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', `<ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript">${segment('0:05', 'From the panel')}</ytd-engagement-panel-section-list-renderer>`);
    });
    const result = await fetchTranscriptInPageContext('video');
    expect(result).toMatchObject({ status: 'ok', segments: [{ text: 'From the panel', startSec: 5 }] });
    expect(result.debugLines).toContainEqual(expect.stringMatching(/Transcript panel: clicked "Show transcript" in the description$/));
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
    document.body.insertAdjacentHTML('beforeend', segment('0:00', 'Hi'));
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({ chapters: [{ title: 'Chapter one', timeSec: 1.5 }] });
    window.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId = 'old-video';
    await expect(fetchTranscriptInPageContext('video')).resolves.toMatchObject({ chapters: [] });
  });

  test('ignores a transcript left on the page by the previous video', async () => {
    document.getElementById('movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: 'old-video' } });
    document.body.insertAdjacentHTML('beforeend', segment('0:00', 'Old video'));
    const result = await fetchTranscriptInPageContext('video');
    expect(result.status).toBe('error');
    expect(result.debugLines).toContainEqual(expect.stringMatching(/Transcript panel: the player still shows another video, skipping$/));
  });

  test('a page without any transcript reports it and leaves no timers behind', async () => {
    const pending = fetchTranscriptInPageContext('video');
    await jest.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result).toMatchObject({ status: 'error', error: 'No transcript found on the YouTube page.' });
    expect(result.debugLines.at(-1)).toMatch(/No transcript found on the page$/);
    expect(result.debugLines.every(line => /^\+\d+ms /.test(line))).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
