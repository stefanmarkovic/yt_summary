// LLM transport module (Google Gemini and OpenRouter only)
// Prompt construction lives in prompts.js (loaded before this file)
/* exported llmSummarizeLong, llmExtractEntities, llmQuiz, llmChat */

const LLM_TIMEOUT_MS = 180_000;
const promptBuilders = typeof module !== 'undefined' && module.exports ? require('./prompts.js') : null;
const SUMMARY_DETAILS = promptBuilders ? promptBuilders.DETAIL_PROMPTS : DETAIL_PROMPTS;

const GEMINI_MODELS = Object.freeze([
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite"
]);

const LLM_PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    defaultModel: GEMINI_MODELS[0]
  }),
  openrouter: Object.freeze({
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openrouter/auto"
  })
});

// per 1M tokens
const PRICING = {
  // Gemini 3.7 Flash introductory pricing through 2026-12-31.
  gemini: { input: 0.75, output: 3.75 },
  "gemini-lite": { input: 0.30, output: 2.50 }
};

function normalizeLlmConfig(rawConfig = {}) {
  if (!rawConfig || typeof rawConfig !== 'object') rawConfig = {};
  const legacyLite = rawConfig.provider === 'gemini-lite';
  const supportedProvider = legacyLite || Object.prototype.hasOwnProperty.call(LLM_PROVIDERS, rawConfig.provider);
  const provider = legacyLite ? 'gemini' : (supportedProvider ? rawConfig.provider : 'gemini');
  const preset = LLM_PROVIDERS[provider];

  let model;
  if (provider === 'gemini') {
    const modelMigrations = {
      'gemini-3-flash-preview': GEMINI_MODELS[0],
      'gemini-3.1-flash-lite': GEMINI_MODELS[1]
    };
    const requestedModel = legacyLite
      ? GEMINI_MODELS[1]
      : (modelMigrations[rawConfig.model] || rawConfig.model);
    model = GEMINI_MODELS.includes(requestedModel) ? requestedModel : preset.defaultModel;
  } else {
    model = typeof rawConfig.model === 'string' && rawConfig.model.trim()
      ? rawConfig.model.trim()
      : preset.defaultModel;
  }

  return {
    ...rawConfig,
    provider,
    url: preset.url,
    model,
    apiKey: supportedProvider && typeof rawConfig.apiKey === 'string' ? rawConfig.apiKey.trim() : '',
    contextWindow: Number.isInteger(Number(rawConfig.contextWindow)) && Number(rawConfig.contextWindow) > 0 ? Number(rawConfig.contextWindow) : 32768,
    temperature: rawConfig.temperature != null && rawConfig.temperature !== '' && Number.isFinite(Number(rawConfig.temperature))
      ? Math.min(2, Math.max(0, Number(rawConfig.temperature))) : 0.7,
    topP: rawConfig.topP != null && rawConfig.topP !== '' && Number.isFinite(Number(rawConfig.topP))
      ? Math.min(1, Math.max(0, Number(rawConfig.topP))) : 1
  };
}

function assertSupportedConfig(config) {
  if (!config || !Object.prototype.hasOwnProperty.call(LLM_PROVIDERS, config.provider)) {
    throw new Error("Nepodržan LLM provajder. Dozvoljeni su samo Google Gemini i OpenRouter.");
  }
  const preset = LLM_PROVIDERS[config.provider];
  if (config.url !== preset.url) {
    throw new Error(`Nedozvoljen API URL za provajdera '${config.provider}'.`);
  }
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
    throw new Error("API ključ je obavezan.");
  }
  if (config.provider === 'gemini' && !GEMINI_MODELS.includes(config.model)) {
    throw new Error("Nepodržan Google Gemini model.");
  }
  if (config.provider === 'openrouter' && (!config.model || !String(config.model).trim())) {
    throw new Error("OpenRouter model je obavezan.");
  }
}

// === Interni provider seam-ovi ===

function buildGeminiRequest(config, systemInstruction, userMessage, history) {
  const url = config.url.replace('{model}', config.model);
  const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
  
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: config.temperature ?? 0.7, topP: config.topP ?? 1 }
  };
  
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey };
  return { url, headers, body: JSON.stringify(body) };
}

function buildOpenRouterRequest(config, systemInstruction, userMessage, history) {
  const url = config.url;
  const messages = [{ role: "system", content: systemInstruction }];
  for (const h of history) {
    messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.parts.map(part => part.text || '').join('') });
  }
  messages.push({ role: "user", content: userMessage });
  const headers = { 'Content-Type': 'application/json' };
  headers['Authorization'] = `Bearer ${config.apiKey}`;
  headers['X-OpenRouter-Title'] = 'YT Summary AI';
  
  const body = { 
    model: config.model, 
    messages,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1.0
  };
  
  return { url, headers, body: JSON.stringify(body) };
}

function parseGeminiResponse(result, config) {
  if (result?.error) throw new Error(result.error.message || 'Google Gemini API greška.');
  const candidate = result?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
  if (!text.trim()) {
    const reason = result?.promptFeedback?.blockReason || candidate?.finishReason;
    throw new Error(`API nije vratio tekst odgovora.${reason ? ` Razlog: ${reason}.` : ''}`);
  }
  const meta = result.usageMetadata || {};
  const outputTokens = (Number.isFinite(meta.candidatesTokenCount) ? meta.candidatesTokenCount : 0)
    + (Number.isFinite(meta.thoughtsTokenCount) ? meta.thoughtsTokenCount : 0);
  const usage = calculateUsage(config.provider, config.model, meta.promptTokenCount, outputTokens);
  return { text, usage };
}

function parseOpenRouterResponse(result, config) {
  if (result?.error) throw new Error(result.error.message || "OpenRouter API greška.");
  const text = result?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error("API did not return a text response.");
  const meta = result.usage || {};
  const usage = calculateUsage(config.provider, config.model, meta.prompt_tokens, meta.completion_tokens);
  if (Number.isFinite(meta.cost) && meta.cost >= 0) usage.estimatedCost = meta.cost.toFixed(6);
  return { text, usage };
}

function handleHttpError(response, provider) {
  if (response.status === 429) {
    throw new Error(`API Quota Exceeded (HTTP 429). Vaš limit za upite kod provajdera '${provider}' je potrošen. Pokušajte kasnije.`);
  }
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

function calculateUsage(provider, modelName, promptTokens = 0, outputTokens = 0) {
  promptTokens = Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0;
  outputTokens = Number.isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0;
  let pricing;
  if (provider === 'gemini') {
    pricing = modelName.includes('lite') ? PRICING["gemini-lite"] : PRICING.gemini;
    if (modelName === GEMINI_MODELS[0] && Date.now() >= Date.UTC(2027, 0, 1)) {
      pricing = { input: 1.50, output: 7.50 };
    }
  } else pricing = { input: 0, output: 0 };
  const costInput = (promptTokens / 1_000_000) * pricing.input;
  const costOutput = (outputTokens / 1_000_000) * pricing.output;
  const estimatedCost = (costInput + costOutput).toFixed(6);
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, estimatedCost };
}

function cleanJsonResponse(text) {
  return text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
}

// === Glavni LLM request ===

async function llmRequest(config, systemInstruction, userMessage, history = [], maxRetries = 2) {
  assertSupportedConfig(config);
  config = normalizeLlmConfig(config);
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('Invalid retry count.');
  let attempt = 0;
  
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
      const isGemini = config.provider === 'gemini';
      const { url, headers, body } = isGemini
        ? buildGeminiRequest(config, systemInstruction, userMessage, history)
        : buildOpenRouterRequest(config, systemInstruction, userMessage, history);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
          clearTimeout(timeoutId);
          attempt++;
          const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff + jitter
          console.warn(`[LLM] HTTP ${response.status}. Retry ${attempt}/${maxRetries} in ${Math.round(waitTime)}ms.`);
          await new Promise(r => setTimeout(r, waitTime));
          continue; // Probaj ponovo
        }
        
        handleHttpError(response, config.provider);
        const errText = await response.text().catch(() => '');
        throw new Error(`${config.provider} API: HTTP ${response.status} — ${errText.substring(0, 200)}`);
      }

      const result = await response.json();
      return isGemini
        ? parseGeminiResponse(result, config)
        : parseOpenRouterResponse(result, config);
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
  
  if (chunks.length <= 1) {
    return llmSummarize(config, transcript, detailLevel, persona, chapters, outputLanguage);
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
  
  // Kombinovana potrošnja
  finalRes.usage.promptTokens += totalUsage.promptTokens;
  finalRes.usage.outputTokens += totalUsage.outputTokens;
  finalRes.usage.totalTokens += totalUsage.totalTokens;
  finalRes.usage.estimatedCost = (parseFloat(finalRes.usage.estimatedCost) + parseFloat(totalUsage.estimatedCost)).toFixed(6);

  return finalRes;
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
    instruction: `Odgovaraj na pitanja korisnika na osnovu ovog transkripta na ${outputLanguage} jeziku. Zadrži format [MM:SS] ako citiraš deo videa.`,
    userMessage,
    history,
    outputLanguage
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GEMINI_MODELS,
    LLM_PROVIDERS,
    normalizeLlmConfig,
    assertSupportedConfig,
    buildGeminiRequest,
    buildOpenRouterRequest,
    parseGeminiResponse,
    parseOpenRouterResponse,
    calculateUsage,
    llmRequest,
    chunkTranscript,
    llmSummarizeLong,
    llmExtractEntities,
    llmQuiz,
    llmChat,
    cleanJsonResponse
  };
}
