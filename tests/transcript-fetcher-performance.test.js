const { fetchTranscriptInPageContext } = require('../transcript-fetcher.js');

describe('transcript panel speed', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="movie_player"></div><ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>';
    document.getElementById('movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: 'video' } });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('the description is expanded and "Show transcript" clicked at once, without a fixed pause', async () => {
    const expand = document.createElement('tp-yt-paper-button');
    expand.id = 'expand';
    Object.defineProperty(expand, 'offsetParent', { get: () => document.body });
    document.body.prepend(expand);
    const expandClick = jest.spyOn(expand, 'click');
    const transcriptClick = jest.spyOn(document.querySelector('button'), 'click');
    const pending = fetchTranscriptInPageContext('video');
    await jest.advanceTimersByTimeAsync(10);
    expect(expandClick).toHaveBeenCalled();
    expect(transcriptClick).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(8000);
    await pending;
  });
});
