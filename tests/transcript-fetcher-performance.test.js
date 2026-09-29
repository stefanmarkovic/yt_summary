const { fetchTranscriptInPageContext } = require('../transcript-fetcher.js');

describe('transcript fast-path selection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="movie_player"></div>';
    document.getElementById('movie_player').getPlayerResponse = () => ({
      videoDetails: { videoId: 'video' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'https://captions.test/video' }] } }
    });
    window.ytInitialData = {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'video' } },
      engagementPanels: [{ engagementPanelSectionListRenderer: {
        panelIdentifier: 'engagement-panel-searchable-transcript',
        content: { continuationItemRenderer: { continuationEndpoint: { getTranscriptEndpoint: { params: 'slow' } } } }
      } }]
    };
    window.ytcfg = { get: key => {
      if (key === 'INNERTUBE_API_KEY') return 'test-key';
      if (key === 'INNERTUBE_CONTEXT') return { client: { clientName: 'WEB', clientVersion: 'test-version' } };
      return undefined;
    } };
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
    delete window.ytInitialData;
    delete window.ytcfg;
  });

  test('returns a direct result without waiting for fallback and aborts the losing request', async () => {
    let fallbackSignal;
    global.fetch = jest.fn((url, options) => {
      if (url === 'https://captions.test/video') return Promise.resolve({
        ok: true, status: 200, headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ events: [{ segs: [{ utf8: 'Fast caption' }] }] })
      });
      fallbackSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const result = await fetchTranscriptInPageContext('video');
    expect(result.status).toBe('ok');
    expect(result.segments[0].text).toBe('Fast caption');
    expect(fallbackSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
