// LLM transport module (OpenRouter)
// Prompt construction lives in prompts.js (loaded before this file)
/* exported llmSummarizeLong, llmExtractEntities, llmQuiz, llmChat, OPENROUTER_URL, DEFAULT_MODEL, describeLlmCall */

const LLM_TIMEOUT_MS = 180_000;
const promptBuilders = typeof module !== 'undefined' && module.exports ? require('./prompts.js') : null;
const SUMMARY_DETAILS = promptBuilders ? promptBuilders.DETAIL_PROMPTS : DETAIL_PROMPTS;

const PROVIDER = 'openrouter';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/auto';
// OpenRouter's default routing weights providers by price, which measured 2-3x slower than sorting by throughput.
const PROVIDER_ROUTING = { fastest: { sort: 'throughput' }, balanced: null };
const DEFAULT_ROUTING = 'fastest';
// Every model offered in Settings takes at least 1M tokens, so 400k fits a multi-hour transcript in one call.
const DEFAULT_CONTEXT_WINDOW = 400_000;
// Releases before 4.5.3 saved this default into every config; treat it as unset so those configs get the new one.
const LEGACY_DEFAULT_CONTEXT_WINDOW = 32768;

function normalizeLlmConfig(rawConfig = {}) {
  if (!rawConfig || typeof rawConfig !== 'object') rawConfig = {};
  // eslint-disable-next-line no-unused-vars
  const { url, provider, ...rest } = rawConfig;
  // Configs saved before the OpenRouter-only release carry a Google (or older) key that OpenRouter rejects.
  const legacy = provider !== undefined && provider !== PROVIDER;
  const model = !legacy && typeof rest.model === 'string' && rest.model.trim() ? rest.model.trim() : DEFAULT_MODEL;
  const contextWindow = Number(rest.contextWindow);
  return {
    ...rest,
    provider: PROVIDER,
    model,
    routing: Object.prototype.hasOwnProperty.call(PROVIDER_ROUTING, rest.routing) ? rest.routing : DEFAULT_ROUTING,
    apiKey: !legacy && typeof rest.apiKey === 'string' ? rest.apiKey.trim() : '',
    contextWindow: Number.isInteger(contextWindow) && contextWindow > 0 && contextWindow !== LEGACY_DEFAULT_CONTEXT_WINDOW
      ? contextWindow : DEFAULT_CONTEXT_WINDOW,
    temperature: rest.temperature != null && rest.temperature !== '' && Number.isFinite(Number(rest.temperature))
      ? Math.min(2, Math.max(0, Number(rest.temperature))) : 0.7,
    topP: rest.topP != null && rest.topP !== '' && Number.isFinite(Number(rest.topP))
      ? Math.min(1, Math.max(0, Number(rest.topP))) : 1
  };
}

function assertSupportedConfig(config) {
  if (!config || config.provider !== PROVIDER) {
    throw new Error('Unsupported LLM configuration. Open Settings and save an OpenRouter API key.');
  }
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
    throw new Error('An OpenRouter API key is required.');
  }
  if (typeof config.model !== 'string' || !config.model.trim()) {
    throw new Error('An OpenRouter model is required.');
  }
}

function buildOpenRouterRequest(config, systemInstruction, userMessage, history) {
  const messages = [{ role: 'system', content: systemInstruction }];
  for (const h of history) {
    messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.parts.map(part => part.text || '').join('') });
  }
  messages.push({ role: 'user', content: userMessage });
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    'X-OpenRouter-Title': 'YT Summary AI'
  };
  const body = {
    model: config.model,
    messages,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1.0
  };
  if (PROVIDER_ROUTING[config.routing]) body.provider = PROVIDER_ROUTING[config.routing];
  return { url: OPENROUTER_URL, headers, body: JSON.stringify(body) };
}

function buildUsage(promptTokens, outputTokens, cost) {
  promptTokens = Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0;
  outputTokens = Number.isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  const estimatedCost = (Number.isFinite(cost) && cost >= 0 ? cost : 0).toFixed(6);
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, estimatedCost };
}

function parseOpenRouterResponse(result) {
  if (result?.error) throw new Error(`OpenRouter: ${result.error.message || 'API error.'}`);
  const choice = result?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const reason = choice?.finish_reason || choice?.native_finish_reason;
    throw new Error(`API did not return a text response.${reason ? ` Reason: ${reason}.` : ''}`);
  }
  const meta = result.usage || {};
  return {
    text,
    usage: buildUsage(meta.prompt_tokens, meta.completion_tokens, meta.cost),
    meta: { model: typeof result.model === 'string' ? result.model : null, provider: typeof result.provider === 'string' ? result.provider : null }
  };
}

const HTTP_ERRORS = {
  401: 'OpenRouter rejected the API key (HTTP 401). Use an API key from openrouter.ai/keys, not a management key.',
  402: 'OpenRouter credits are exhausted or the key limit is reached (HTTP 402).',
  429: 'API quota exceeded (HTTP 429). OpenRouter is rate limiting this key. Try again later.'
};

async function httpError(response) {
  if (HTTP_ERRORS[response.status]) return new Error(HTTP_ERRORS[response.status]);
  const errText = await response.text().catch(() => '');
  let detail = errText.substring(0, 200);
  try { detail = JSON.parse(errText).error?.message || detail; } catch { /* not JSON */ }
  return new Error(`OpenRouter API: HTTP ${response.status} — ${detail}`);
}

// === Zajednička infrastruktura ===

let usageWrite = Promise.resolve();
function updateGlobalUsage(usage) {
  usageWrite = usageWrite.then(async () => {
    const data = await browser.storage.local.get('total_usage');
    const u = data.total_usage || {};
    const tokens = Number(u.tokens);
    const cost = Number(u.cost);
    await browser.storage.local.set({ total_usage: {
      tokens: (Number.isFinite(tokens) && tokens >= 0 ? tokens : 0) + usage.totalTokens,
      cost: (Number.isFinite(cost) && cost >= 0 ? cost : 0) + Number(usage.estimatedCost)
    } });
  }).catch(error => {
    console.warn('[LLM] Usage could not be saved:', error.message);
  });
  return usageWrite;
}

// Small models often leave a code fence unclosed or wrap the JSON in a sentence.
function cleanJsonResponse(text) {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = unfenced.search(/[[{]/);
  const end = Math.max(unfenced.lastIndexOf(']'), unfenced.lastIndexOf('}'));
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

// === Glavni LLM request ===

async function llmRequest(config, systemInstruction, userMessage, history = [], maxRetries = 2) {
  assertSupportedConfig(config);
  config = normalizeLlmConfig(config);
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('Invalid retry count.');
  let attempt = 0;
  const startedAt = Date.now();

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const { url, headers, body } = buildOpenRouterRequest(config, systemInstruction, userMessage, history);
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });

      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
          clearTimeout(timeoutId);
          attempt++;
          const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.warn(`[LLM] HTTP ${response.status}. Retry ${attempt}/${maxRetries} in ${Math.round(waitTime)}ms.`);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }
        throw await httpError(response);
      }

      const result = parseOpenRouterResponse(await response.json());
      result.meta.durationMs = Date.now() - startedAt;
      result.meta.attempts = attempt + 1;
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('API request timed out. Please try again.');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// === Duboki task modul ===

async function llmTask(config, transcript, taskSpec) {
  assertSupportedConfig(config);
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Transcript is empty.');
  config = normalizeLlmConfig(config);
  let processedTranscript = transcript;
  if (config.contextWindow) {
    const maxChars = config.contextWindow * 3.5; // Rezervišemo prostor za prompt i odgovor
    if (transcript.length > maxChars) {
      console.warn(`[LLM] Transkript je predugačak (${transcript.length} kar). Skraćujem na ${Math.round(maxChars)} kar.`);
      processedTranscript = transcript.substring(0, maxChars) + "\n\n[...TRANSKRIPT SKRAĆEN ZBOG OGRANIČENJA KONTEKSTA...]";
    }
  }

  const sysInst = (promptBuilders ? promptBuilders.buildSystemInstruction : buildSystemInstruction)(processedTranscript, taskSpec);
  const result = await llmRequest(config, sysInst, taskSpec.userMessage || "Generiši.", taskSpec.history || []);
  await updateGlobalUsage(result.usage);
  if (taskSpec.parseAs === 'json') {
    result.text = cleanJsonResponse(result.text);
  }
  return result;
}

// === Javne task funkcije ===

function llmSummarize(config, transcript, detailLevel, persona, chapters = [], outputLanguage = 'English') {
  return llmTask(config, transcript, { instruction: SUMMARY_DETAILS[detailLevel] || SUMMARY_DETAILS['2'], persona, chapters, outputLanguage, summary: true });
}

function chunkTranscript(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars < 1) throw new Error('Chunk size must be positive.');
  maxChars = Math.floor(maxChars);
  const chunks = [];
  let currentPos = 0;
  while (currentPos < text.length) {
    let endPos = currentPos + maxChars;
    if (endPos < text.length) {
      // Pokušaj da nađeš kraj rečenice. Ako nema interpunkcije (čest slučaj kod ASR transkripata),
      // seči na razmaku umesto usred reči.
      const lastDot = text.lastIndexOf('. ', endPos);
      if (lastDot > currentPos + (maxChars * 0.8)) {
        endPos = lastDot + 1;
      } else {
        const lastSpace = text.lastIndexOf(' ', endPos);
        if (lastSpace > currentPos + (maxChars * 0.8)) {
          endPos = lastSpace + 1;
        }
      }
    }
    const chunk = text.substring(currentPos, endPos).trim();
    if (chunk) chunks.push(chunk);
    currentPos = endPos;
  }
  return chunks;
}

async function llmSummarizeLong(config, transcript, detailLevel, persona, chapters = [], outputLanguage = 'English', onProgress) {
  assertSupportedConfig(config);
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Transcript is empty.');
  config = normalizeLlmConfig(config);
  const maxChars = Math.floor(config.contextWindow * 3.0);
  const chunks = chunkTranscript(transcript, maxChars);
  
  const calls = [];
  const record = (phase, res) => calls.push({ phase, ...res.meta, promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens });
  if (chunks.length <= 1) {
    const single = await llmSummarize(config, transcript, detailLevel, persona, chapters, outputLanguage);
    record('summary', single);
    return { ...single, calls };
  }

  if (onProgress) onProgress(`Video is long. Splitting into ${chunks.length} chunks...`);

  // 1. MAP faza: Sažmi svaki chunk
  const partialSummaries = [];
  const totalUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: '0.000000' };

  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(`Processing chunk ${i + 1} of ${chunks.length}...`);
    const taskSpec = {
      instruction: `Ovo je deo ${i + 1} transkripta. Napravi veoma sažet ali informativan rezime ovog dela u buletima.`,
      persona: "standard",
      outputLanguage
    };
    const res = await llmTask(config, chunks[i], taskSpec);
    record(`chunk ${i + 1}/${chunks.length}`, res);
    partialSummaries.push(res.text);
    
    totalUsage.promptTokens += res.usage.promptTokens;
    totalUsage.outputTokens += res.usage.outputTokens;
    totalUsage.totalTokens += res.usage.totalTokens;
    totalUsage.estimatedCost = (parseFloat(totalUsage.estimatedCost) + parseFloat(res.usage.estimatedCost)).toFixed(6);
  }

  // 2. REDUCE faza: Finalni sažetak
  if (onProgress) onProgress("Merging chunks into final summary...");
  let combinedText = partialSummaries.join("\n\n--- DEO ---\n\n");
  // Reduce in bounded groups so the final task never silently drops later chunks.
  for (let pass = 0; combinedText.length > maxChars; pass++) {
    if (pass >= 4) throw new Error('Partial summaries exceed the configured context window. Increase the context window.');
    const reduced = [];
    for (const group of chunkTranscript(combinedText, maxChars)) {
      const res = await llmTask(config, group, {
        instruction: 'Sažmi ove beleške sažeto, sačuvaj ključne činjenice i postojeće vremenske oznake.',
        outputLanguage
      });
      record(`reduce pass ${pass + 1}`, res);
      reduced.push(res.text);
      totalUsage.promptTokens += res.usage.promptTokens;
      totalUsage.outputTokens += res.usage.outputTokens;
      totalUsage.totalTokens += res.usage.totalTokens;
      totalUsage.estimatedCost = (Number(totalUsage.estimatedCost) + Number(res.usage.estimatedCost)).toFixed(6);
    }
    const nextText = reduced.join('\n\n');
    if (nextText.length >= combinedText.length) throw new Error('Partial summaries did not fit the context window. Increase the context window.');
    combinedText = nextText;
  }
  const finalTaskSpec = {
    instruction: `Evo sažetaka različitih delova jednog videa. Na osnovu njih napravi finalni, koherentan i strukturiran sažetak celog videa. ${SUMMARY_DETAILS[detailLevel] || SUMMARY_DETAILS['2']}`,
    persona,
    chapters, // Prosleđujemo poglavlja u finalnu fazu radi strukture
    outputLanguage,
    summary: true
  };
  
  const finalRes = await llmTask(config, combinedText, finalTaskSpec);
  record('final', finalRes);
  
  // Kombinovana potrošnja
  finalRes.usage.promptTokens += totalUsage.promptTokens;
  finalRes.usage.outputTokens += totalUsage.outputTokens;
  finalRes.usage.totalTokens += totalUsage.totalTokens;
  finalRes.usage.estimatedCost = (parseFloat(finalRes.usage.estimatedCost) + parseFloat(totalUsage.estimatedCost)).toFixed(6);

  return { ...finalRes, calls };
}

function describeLlmCall({ phase, durationMs, model, provider, promptTokens, outputTokens, attempts }) {
  const outputRate = durationMs > 0 ? Math.round(outputTokens / (durationMs / 1000)) : 0;
  return `${phase}: ${(durationMs / 1000).toFixed(1)}s, ${model || '?'} via ${provider || '?'}, `
    + `${promptTokens} in / ${outputTokens} out tokens, ${outputRate} out tok/s${attempts > 1 ? `, ${attempts} attempts` : ''}`;
}

function llmExtractEntities(config, transcript, outputLanguage = 'English') {
  return llmTask(config, transcript, {
    instruction: `Izvuci listu Alata, Tehnologija, Lokacija ili Osoba koji se pominju u videu. Vrati rezultat ISKLJUČIVO kao validan JSON niz stringova (npr. ["Alat 1", "Osoba 2"]). Ne piši nikakav drugi tekst.`,
    userMessage: "Generiši JSON.",
    parseAs: 'json',
    outputLanguage
  }).then(result => {
    const entities = JSON.parse(result.text);
    if (!Array.isArray(entities) || entities.some(entity => typeof entity !== 'string')) {
      throw new Error('API did not return a list of entities.');
    }
    return [...new Set(entities.map(entity => entity.trim()).filter(Boolean))];
  });
}

function llmQuiz(config, transcript, outputLanguage = 'English') {
  return llmTask(config, transcript, {
    instruction: `Na osnovu ovog transkripta, generiši 3 do 5 pitanja sa višestrukim izborom kako bih proverio znanje. Vrati rezultat ISKLJUČIVO kao validan JSON niz objekata u sledećem formatu: [{"question": "Tekst pitanja", "options": ["A", "B", "C"], "answerIndex": 0}]. Ne piši nikakav dodatni tekst ili markdown.`,
    userMessage: "Generiši JSON kviz.",
    parseAs: 'json',
    outputLanguage
  });
}

function llmChat(config, transcript, history, userMessage, outputLanguage = 'English') {
  return llmTask(config, transcript, {
    instruction: `Odgovaraj na pitanja korisnika na osnovu ovog transkripta. Zadrži format [MM:SS] ako citiraš deo videa.`,
    userMessage,
    history,
    outputLanguage
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OPENROUTER_URL,
    DEFAULT_MODEL,
    normalizeLlmConfig,
    assertSupportedConfig,
    buildOpenRouterRequest,
    parseOpenRouterResponse,
    buildUsage,
    llmRequest,
    chunkTranscript,
    llmSummarizeLong,
    describeLlmCall,
    llmExtractEntities,
    llmQuiz,
    llmChat,
    cleanJsonResponse
  };
}
