const { processTranscriptSegments, getProcessedTranscript, getSponsorSegments } = require('../transcript-pipeline.js');

describe('shared transcript processing', () => {
  const captions = [
    { text: 'Useful introduction', startSec: 0, durSec: 10 },
    { text: 'Advertisement', startSec: 10, durSec: 5 },
    { text: 'Useful conclusion', startSec: 15, durSec: 10 }
  ];
  test('keeps useful boundary captions and removes mainly sponsored captions', () => {
    expect(processTranscriptSegments(captions, [{ category: 'sponsor', segment: [9, 16] }])).toMatchObject({
      text: '[0:00] Useful introduction [0:15] Useful conclusion',
      savedSeconds: 5, categoryStats: { sponsor: 7 }, sponsorCount: 1, segmentCount: 3
    });
  });
  test('merges overlapping sponsor intervals and removed captions for duration totals', () => {
    const overlapping = [...captions, { text: 'Duplicate advertisement', startSec: 11, durSec: 4 }];
    expect(processTranscriptSegments(overlapping, [
      { category: 'sponsor', segment: [10, 13] }, { category: 'sponsor', segment: [12, 15] }
    ])).toMatchObject({ savedSeconds: 5, categoryStats: { sponsor: 5 } });
  });
  test('malformed and unknown SponsorBlock entries cannot break processing or mutate prototypes', () => {
    const result = processTranscriptSegments(captions, [null, {},
      { category: 'sponsor', segment: [3, 1] }, { category: '__proto__', segment: [0, 30] },
      { category: 'sponsor', segment: ['0', 10] }
    ]);
    expect(result.sponsorCount).toBe(0);
    expect(result.text).toContain('Advertisement');
    expect(Object.getPrototypeOf(result.categoryStats)).toBe(Object.prototype);
  });
  test('normalizes caption order, ignores malformed segments and infers missing duration', () => {
    const input = [{ text: 'Second', startSec: 2, durSec: 1 }, { text: ' First ', startSec: 0 },
      { text: 'Invalid', startSec: NaN }, null];
    expect(processTranscriptSegments(input)).toMatchObject({ text: '[0:00] First [0:02] Second', segmentCount: 2 });
    expect(input[1]).not.toHaveProperty('durSec');
  });
  test('zero duration captions are checked at their timestamp', () => {
    const result = processTranscriptSegments([
      { text: 'Keep', startSec: 0, durSec: 1 }, { text: 'Remove', startSec: 10, durSec: 0 }
    ], [{ category: 'sponsor', segment: [10, 15] }]);
    expect(result.text).toBe('[0:00] Keep');
  });
  test('empty or fully filtered transcripts fail before an AI call', () => {
    expect(() => processTranscriptSegments([])).toThrow(/No valid segments/);
    expect(() => processTranscriptSegments(captions, [{ category: 'sponsor', segment: [0, 30] }])).toThrow(/No transcript remains/);
  });
});

describe('transcript cache and optional SponsorBlock', () => {
  beforeEach(() => {
    global.fetchTranscriptInPageContext = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'invalid response' }) });
    global.browser = {
      scripting: { executeScript: jest.fn().mockResolvedValue([{ result: {
        status: 'ok', segments: [{ text: 'Current transcript', startSec: 0, durSec: 1 }]
      } }]) },
      storage: { session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue() } }
    };
  });
  afterEach(() => {
    delete global.fetch;
    delete global.browser;
    delete global.fetchTranscriptInPageContext;
  });
  test('a non-array SponsorBlock response is treated as unavailable', async () => {
    await expect(getSponsorSegments('video')).resolves.toEqual([]);
    await expect(getProcessedTranscript(7, 'video')).resolves.toMatchObject({ text: '[0:00] Current transcript' });
  });
  test.each([undefined, NaN, Date.now() + 100000, Date.now() - 7 * 60 * 60 * 1000])('does not reuse a cache with invalid or expired timestamp %p', async cachedAt => {
    browser.storage.session.get.mockResolvedValue({ yt_transcript_cache: { videoId: 'video', cachedAt, result: { text: 'Stale transcript' } } });
    await expect(getProcessedTranscript(7, 'video')).resolves.toMatchObject({ text: '[0:00] Current transcript' });
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
  test('session storage failures do not discard a fetched transcript', async () => {
    browser.storage.session.get.mockRejectedValue(new Error('storage unavailable'));
    browser.storage.session.set.mockRejectedValue(new Error('storage unavailable'));
    await expect(getProcessedTranscript(7, 'video')).resolves.toMatchObject({ text: '[0:00] Current transcript' });
  });
});
