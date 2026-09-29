const {
  GEMINI_MODELS,
  LLM_PROVIDERS,
  normalizeLlmConfig,
  assertSupportedConfig,
  buildGeminiRequest,
  buildOpenRouterRequest,
  parseGeminiResponse,
  parseOpenRouterResponse,
  calculateUsage,
  llmRequest
} = require('../gemini.js');

describe('allowed LLM providers', () => {
  test('exposes exactly Gemini and OpenRouter, with exactly two Gemini models', () => {
    expect(Object.keys(LLM_PROVIDERS)).toEqual(['gemini', 'openrouter']);
    expect(GEMINI_MODELS).toEqual([
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite'
    ]);
  });

  test.each(['deepseek', 'ollama', 'custom'])('removes legacy %s config and clears its key', provider => {
    expect(normalizeLlmConfig({ provider, url: 'https://example.test', model: 'old', apiKey: 'secret' }))
      .toMatchObject({
        provider: 'gemini',
        url: LLM_PROVIDERS.gemini.url,
        model: GEMINI_MODELS[0],
        apiKey: ''
      });
  });

  test('migrates the legacy Gemini Lite provider to the second allowed Google model', () => {
    expect(normalizeLlmConfig({ provider: 'gemini-lite', apiKey: 'google-key' }))
      .toMatchObject({ provider: 'gemini', model: GEMINI_MODELS[1], apiKey: 'google-key' });
  });

  test.each([
    ['gemini-3-flash-preview', 'gemini-3.7-flash'],
    ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
  ])('migrates old model %s to %s', (oldModel, newModel) => {
    expect(normalizeLlmConfig({ provider: 'gemini', model: oldModel, apiKey: 'google-key' }))
      .toMatchObject({ model: newModel, apiKey: 'google-key' });
  });

  test('rejects removed providers and custom endpoint injection', () => {
    expect(() => assertSupportedConfig({ provider: 'deepseek', apiKey: 'x' })).toThrow(/Nepodržan/);
    expect(() => assertSupportedConfig({
      provider: 'openrouter',
      url: 'https://attacker.test/chat',
      model: 'openrouter/auto',
      apiKey: 'x'
    })).toThrow(/Nedozvoljen API URL/);
  });
});

describe('Google Gemini transport', () => {
  const config = {
    provider: 'gemini',
    url: LLM_PROVIDERS.gemini.url,
    model: GEMINI_MODELS[0],
    apiKey: 'google-key',
    temperature: 0.2,
    topP: 0.8
  };

  test('builds the Google URL, authentication header and conversation body', () => {
    const request = buildGeminiRequest(config, 'system', 'new question', [
      { role: 'model', parts: [{ text: 'previous answer' }] }
    ]);
    expect(request.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`);
    expect(request.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'google-key' });
    expect(JSON.parse(request.body)).toMatchObject({
      systemInstruction: { parts: [{ text: 'system' }] },
      contents: [
        { role: 'model', parts: [{ text: 'previous answer' }] },
        { role: 'user', parts: [{ text: 'new question' }] }
      ]
    });
    expect(JSON.parse(request.body).generationConfig).toEqual({ temperature: 0.2, topP: 0.8 });
  });

  test('parses Gemini text and usage', () => {
    expect(parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'Google answer' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
    }, config)).toMatchObject({
      text: 'Google answer',
      usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15 }
    });
  });

  test('uses current paid-tier prices for both upgraded Google models', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 29));
    expect(calculateUsage('gemini', 'gemini-3.7-flash', 1_000_000, 1_000_000).estimatedCost)
      .toBe('4.500000');
    expect(calculateUsage('gemini', 'gemini-3.5-flash-lite', 1_000_000, 1_000_000).estimatedCost)
      .toBe('2.800000');
    jest.restoreAllMocks();
  });

  test('dispatches a Google request through fetch and parses its response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'live-shaped Google response' }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 }
      })
    });

    await expect(llmRequest(config, 'system', 'question')).resolves.toMatchObject({
      text: 'live-shaped Google response',
      usage: { totalTokens: 7 }
    });
    expect(global.fetch).toHaveBeenCalledWith(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-goog-api-key': 'google-key' }) })
    );
  });
});

describe('LLM response and configuration boundaries', () => {
  const config = normalizeLlmConfig({ provider: 'gemini', apiKey: 'test-key' });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test.each([null, undefined, { contextWindow: -1 }, { contextWindow: Infinity }, { contextWindow: 'garbage' }])('normalizes invalid configuration %p without a negative chunk limit', input => {
    expect(normalizeLlmConfig(input).contextWindow).toBe(32768);
  });

  test('keeps explicit zero sampling values and clamps out of range settings', () => {
    expect(normalizeLlmConfig({ temperature: 0, topP: 0 })).toMatchObject({ temperature: 0, topP: 0 });
    expect(normalizeLlmConfig({ temperature: null, topP: '' })).toMatchObject({ temperature: 0.7, topP: 1 });
    expect(normalizeLlmConfig({ temperature: 9, topP: -2 })).toMatchObject({ temperature: 2, topP: 0 });
  });

  test('combines text parts, excludes thoughts and bills thinking tokens', () => {
    expect(parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'private', thought: true }, { text: 'First ' }, { text: 'second' }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, thoughtsTokenCount: 4 }
    }, config)).toMatchObject({ text: 'First second', usage: { promptTokens: 2, outputTokens: 7, totalTokens: 9 } });
  });

  test('blocked and empty provider responses produce useful errors', () => {
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }, config)).toThrow(/SAFETY/);
    expect(() => parseGeminiResponse({ candidates: [{ finishReason: 'SAFETY' }] }, config)).toThrow(/SAFETY/);
    expect(() => parseOpenRouterResponse({ choices: [{ message: { content: null } }] }, config)).toThrow(/text response/);
  });

  test('uses announced standard pricing after the introductory period', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2027, 0, 1));
    expect(calculateUsage('gemini', GEMINI_MODELS[0], 1_000_000, 1_000_000).estimatedCost).toBe('9.000000');
    expect(calculateUsage('gemini', GEMINI_MODELS[1], 1_000_000, 1_000_000).estimatedCost).toBe('2.800000');
  });

  test('invalid token metadata cannot poison accumulated usage', () => {
    expect(calculateUsage('gemini', GEMINI_MODELS[0], null, -1)).toMatchObject({ promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: '0.000000' });
  });

  test('retries transient unavailable responses with a fresh request', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Recovered' }] } }] }) });
    const pending = llmRequest(config, 'system', 'question');
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('quota and authentication errors are never retried', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(llmRequest(config, 'system', 'question')).rejects.toThrow(/429/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a request timeout gives an actionable error and clears the timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = llmRequest(config, 'system', 'question').catch(error => error);
    await jest.advanceTimersByTimeAsync(180000);
    await expect(pending).resolves.toEqual(expect.objectContaining({ message: expect.stringMatching(/timed out/) }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('OpenRouter transport', () => {
  const config = {
    provider: 'openrouter',
    url: LLM_PROVIDERS.openrouter.url,
    model: 'openrouter/auto',
    apiKey: 'openrouter-key',
    temperature: 0.4,
    topP: 0.9
  };

  test('builds the fixed OpenRouter endpoint, bearer auth and OpenAI-compatible messages', () => {
    const request = buildOpenRouterRequest(config, 'system', 'new question', [
      { role: 'model', parts: [{ text: 'previous answer' }] }
    ]);
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer openrouter-key',
      'X-OpenRouter-Title': 'YT Summary AI'
    });
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'previous answer' },
        { role: 'user', content: 'new question' }
      ]
    });
  });

  test('parses OpenRouter text, token usage and reported cost', () => {
    expect(parseOpenRouterResponse({
      choices: [{ message: { content: 'OpenRouter answer' } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, cost: 0.001234 }
    }, config)).toEqual({
      text: 'OpenRouter answer',
      usage: { promptTokens: 20, outputTokens: 7, totalTokens: 27, estimatedCost: '0.001234' }
    });
  });

  test('dispatches a request through fetch and parses its response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'live-shaped response' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      })
    });

    await expect(llmRequest(config, 'system', 'question')).resolves.toMatchObject({
      text: 'live-shaped response',
      usage: { totalTokens: 5 }
    });
    expect(global.fetch).toHaveBeenCalledWith(
      LLM_PROVIDERS.openrouter.url,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer openrouter-key' }) })
    );
  });
});
