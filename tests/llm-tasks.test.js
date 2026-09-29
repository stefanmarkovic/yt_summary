const {
  normalizeLlmConfig, llmSummarizeLong, llmExtractEntities, llmQuiz, llmChat, cleanJsonResponse, chunkTranscript
} = require('../gemini.js');

describe('public LLM tasks', () => {
  const config = normalizeLlmConfig({ provider: 'gemini', apiKey: 'test-key', contextWindow: 50 });
  let storedUsage;
  beforeEach(() => {
    storedUsage = undefined;
    global.browser = { storage: { local: {
      get: jest.fn(async () => ({ total_usage: storedUsage })),
      set: jest.fn(async value => { storedUsage = value.total_usage; })
    } } };
  });
  afterEach(() => {
    delete global.browser;
    delete global.fetch;
    jest.restoreAllMocks();
  });
  function answer(text, promptTokens = 2, outputTokens = 3) {
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: outputTokens } }) };
  }
  test('quiz and entity requests keep JSON instructions free of summary format', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(answer('```json\n[" Tool ", "Tool", ""]\n```'))
      .mockResolvedValueOnce(answer('[{"question":"Question","options":["A","B"],"answerIndex":0}]'));
    await expect(llmExtractEntities(config, 'Tools mentioned')).resolves.toEqual(['Tool']);
    const quiz = await llmQuiz(config, 'Question material');
    expect(JSON.parse(quiz.text)).toEqual([{ question: 'Question', options: ['A', 'B'], answerIndex: 0 }]);
    for (const [, options] of fetch.mock.calls) {
      const prompt = JSON.parse(options.body).systemInstruction.parts[0].text;
      expect(prompt).not.toContain('TL;DR:');
    }
    expect(storedUsage.tokens).toBe(10);
  });
  test('malformed entity output surfaces as a failure instead of pretending there were no entities', async () => {
    global.fetch = jest.fn().mockResolvedValue(answer('{"tools": ["Tool"]}'));
    await expect(llmExtractEntities(config, 'Tools')).rejects.toThrow(/list of entities/);
    expect(storedUsage.tokens).toBe(5);
  });
  test('chat retains history and answers the question without forcing a video summary', async () => {
    global.fetch = jest.fn().mockResolvedValue(answer('An answer'));
    await llmChat(config, 'Transcript', [{ role: 'model', parts: [{ text: 'Prior reply' }] }], 'Why?');
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.contents).toEqual([
      { role: 'model', parts: [{ text: 'Prior reply' }] }, { role: 'user', parts: [{ text: 'Why?' }] }
    ]);
    expect(request.systemInstruction.parts[0].text).not.toContain('TL;DR:');
  });
  test('usage storage failures do not discard a paid response', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    browser.storage.local.set.mockRejectedValue(new Error('storage unavailable'));
    global.fetch = jest.fn().mockResolvedValue(answer('Summary'));
    await expect(llmSummarizeLong(config, 'Short transcript', '2', 'standard')).resolves.toMatchObject({ text: 'Summary' });
  });
  test('concurrent task calls serialize usage updates within one extension page', async () => {
    global.fetch = jest.fn().mockResolvedValue(answer('[]'));
    await Promise.all([llmExtractEntities(config, 'One'), llmExtractEntities(config, 'Two')]);
    expect(storedUsage.tokens).toBe(10);
    expect(browser.storage.local.set).toHaveBeenCalledTimes(2);
  });
  test('map/reduce aggregates all request usage once and retains the last chunk', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(answer('First part'))
      .mockResolvedValueOnce(answer('Last part'))
      .mockResolvedValueOnce(answer('Final summary'));
    const transcript = 'x'.repeat(150) + 'END';
    const result = await llmSummarizeLong(config, transcript, '2', 'standard');
    expect(result).toMatchObject({ text: 'Final summary', usage: { promptTokens: 6, outputTokens: 9, totalTokens: 15 } });
    expect(JSON.parse(fetch.mock.calls[1][1].body).systemInstruction.parts[0].text).toContain('END');
    const finalPrompt = JSON.parse(fetch.mock.calls[2][1].body).systemInstruction.parts[0].text;
    expect(finalPrompt).toContain('First part');
    expect(finalPrompt).toContain('Last part');
    expect(finalPrompt).toContain('TL;DR:');
    expect(storedUsage.tokens).toBe(result.usage.totalTokens);
  });
  test('oversized intermediate summaries are reduced before the final prompt', async () => {
    const longPartial = 'p'.repeat(100);
    global.fetch = jest.fn()
      .mockResolvedValueOnce(answer(longPartial))
      .mockResolvedValueOnce(answer(longPartial))
      .mockResolvedValueOnce(answer('Reduced first'))
      .mockResolvedValueOnce(answer('Reduced last'))
      .mockResolvedValueOnce(answer('Final summary'));
    const result = await llmSummarizeLong(config, 't'.repeat(151), '2', 'standard');
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.usage.totalTokens).toBe(25);
    const finalPrompt = JSON.parse(fetch.mock.calls[4][1].body).systemInstruction.parts[0].text;
    expect(finalPrompt).toContain('Reduced first');
    expect(finalPrompt).toContain('Reduced last');
    expect(finalPrompt).not.toContain('TRANSKRIPT SKRAĆEN');
  });
  test('empty transcripts fail without consuming an API request', async () => {
    global.fetch = jest.fn();
    await expect(llmSummarizeLong(config, ' ', '2', 'standard')).rejects.toThrow(/empty/);
    await expect(llmQuiz(config, '')).rejects.toThrow(/empty/);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('JSON fence cleanup preserves literal backticks inside valid JSON strings', () => {
    expect(cleanJsonResponse('```JSON\n["Use ``` in Markdown"]\n```')).toBe('["Use ``` in Markdown"]');
  });
  test('chunking rejects non-progressing sizes and skips empty chunks', () => {
    expect(() => chunkTranscript('Transcript', -1)).toThrow(/positive/);
    expect(() => chunkTranscript('Transcript', Infinity)).toThrow(/positive/);
    expect(chunkTranscript('   ', 2)).toEqual([]);
  });
});
