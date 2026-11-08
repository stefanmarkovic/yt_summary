const {
  OPENROUTER_URL,
  DEFAULT_MODEL,
  normalizeLlmConfig,
  assertSupportedConfig,
  buildOpenRouterRequest,
  parseOpenRouterResponse,
  buildUsage,
  llmRequest
} = require('../llm.js');

describe('OpenRouter configuration', () => {
  test.each(['gemini', 'gemini-lite', 'deepseek', 'ollama', 'custom'])('a legacy %s config loses its key and model and becomes OpenRouter', provider => {
    expect(normalizeLlmConfig({ provider, url: 'https://example.test', model: 'gemini-3.7-flash', apiKey: 'google-key', uiLanguage: 'sr' }))
      .toEqual(expect.objectContaining({ provider: 'openrouter', model: DEFAULT_MODEL, apiKey: '', uiLanguage: 'sr' }));
  });

  test('an OpenRouter config keeps its key and model and drops the stored URL', () => {
    const config = normalizeLlmConfig({ provider: 'openrouter', url: OPENROUTER_URL, model: ' mistralai/mistral-nemo ', apiKey: ' sk-or-v1-x ' });
    expect(config).toMatchObject({ provider: 'openrouter', model: 'mistralai/mistral-nemo', apiKey: 'sk-or-v1-x' });
    expect(config).not.toHaveProperty('url');
  });

  test('a fresh config defaults to OpenRouter auto routing without a key', () => {
    expect(normalizeLlmConfig({})).toMatchObject({ provider: 'openrouter', model: 'openrouter/auto', apiKey: '' });
  });

  test('rejects configs without OpenRouter provider, key or model', () => {
    expect(() => assertSupportedConfig({ provider: 'gemini', apiKey: 'x', model: 'm' })).toThrow(/Unsupported/);
    expect(() => assertSupportedConfig({ provider: 'openrouter', apiKey: ' ', model: 'm' })).toThrow(/API key is required/);
    expect(() => assertSupportedConfig({ provider: 'openrouter', apiKey: 'x', model: '' })).toThrow(/model is required/);
  });

  test.each([null, undefined, { contextWindow: -1 }, { contextWindow: Infinity }, { contextWindow: 'garbage' }])('normalizes invalid configuration %p without a negative chunk limit', input => {
    expect(normalizeLlmConfig(input).contextWindow).toBe(32768);
  });

  test('keeps explicit zero sampling values and clamps out of range settings', () => {
    expect(normalizeLlmConfig({ temperature: 0, topP: 0 })).toMatchObject({ temperature: 0, topP: 0 });
    expect(normalizeLlmConfig({ temperature: null, topP: '' })).toMatchObject({ temperature: 0.7, topP: 1 });
    expect(normalizeLlmConfig({ temperature: 9, topP: -2 })).toMatchObject({ temperature: 2, topP: 0 });
  });
});

describe('OpenRouter transport', () => {
  const config = normalizeLlmConfig({ provider: 'openrouter', model: 'openrouter/auto', apiKey: 'openrouter-key', temperature: 0.4, topP: 0.9 });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

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
    expect(JSON.parse(request.body)).toEqual({
      model: 'openrouter/auto',
      temperature: 0.4,
      top_p: 0.9,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'previous answer' },
        { role: 'user', content: 'new question' }
      ]
    });
  });

  test('parses text, token usage and the cost OpenRouter reports', () => {
    expect(parseOpenRouterResponse({
      choices: [{ message: { content: 'OpenRouter answer' } }],
      usage: { prompt_tokens: 20, completion_tokens: 7, cost: 0.001234 }
    })).toEqual({
      text: 'OpenRouter answer',
      usage: { promptTokens: 20, outputTokens: 7, totalTokens: 27, estimatedCost: '0.001234' },
      meta: { model: null, provider: null }
    });
  });

  test('reports which model and provider OpenRouter routed to, how long it took and how many attempts', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: async () => ({ model: 'google/gemini-2.5-flash', provider: 'Google', choices: [{ message: { content: 'Routed' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
      }), 1500)));
    const pending = llmRequest(config, 'system', 'question');
    await jest.runAllTimersAsync();
    const { meta } = await pending;
    expect(meta).toMatchObject({ model: 'google/gemini-2.5-flash', provider: 'Google', attempts: 2 });
    expect(meta.durationMs).toBeGreaterThanOrEqual(1500 + 2000);
  });

  test('empty and error responses produce useful errors', () => {
    expect(() => parseOpenRouterResponse({ choices: [{ message: { content: null }, finish_reason: 'length' }] })).toThrow(/text response.*length/);
    expect(() => parseOpenRouterResponse({ error: { message: 'Provider down' } })).toThrow(/Provider down/);
  });

  test('invalid token metadata cannot poison accumulated usage', () => {
    expect(buildUsage(null, -1, NaN)).toEqual({ promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: '0.000000' });
  });

  test('dispatches a request through fetch and parses its response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'live-shaped response' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
    });
    await expect(llmRequest(config, 'system', 'question')).resolves.toMatchObject({ text: 'live-shaped response', usage: { totalTokens: 5 } });
    expect(global.fetch).toHaveBeenCalledWith(OPENROUTER_URL,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer openrouter-key' }) }));
  });

  test('retries transient unavailable responses with a fresh request', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'Recovered' } }] }) });
    const pending = llmRequest(config, 'system', 'question');
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ text: 'Recovered' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([
    [401, /not a management key/],
    [402, /credits/],
    [429, /429/]
  ])('HTTP %i explains itself and is never retried', async (status, message) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status, text: async () => '{"error":{"message":"User not found."}}' });
    await expect(llmRequest(config, 'system', 'question')).rejects.toThrow(message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('other HTTP errors surface the OpenRouter error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"message":"nope/model is not a valid model ID"}}' });
    await expect(llmRequest(config, 'system', 'question')).rejects.toThrow('OpenRouter API: HTTP 400 — nope/model is not a valid model ID');
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
