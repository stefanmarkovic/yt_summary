// Shared LLM API logic (Gemini, DeepSeek, Ollama)

const LLM_TIMEOUT_MS = 180_000;

const DETAIL_PROMPTS = {
  "1": "Kratak rezime.",
  "2": "Srednji rezime sa buletima.",
  "3": "Veoma detaljan rezime."
};

const PERSONA_PROMPTS = {
  "standard": "",
  "skeptic": "Preuzmi ulogu objektivnog analitičara i skeptika. Kritički sagledaj informacije iz videa, istakni potencijalne mane, nelogičnosti ili tvrdnje koje nisu potkrepljene dokazima, ali zadrži profesionalan ton.",
  "educator": "Preuzmi ulogu strpljivog profesora. Objasni koncepte iz videa na jednostavan i razumljiv način, koristeći jasne primere ili analogije gde je to moguće, kako bi gradivo bilo savršeno jasno i početnicima.",
  "journalist": "Preuzmi ulogu profesionalnog novinara. Prenesi ključne informacije iz videa u formi jasnog, objektivnog i lako čitljivog novinarskog izveštaja, ističući najvažnije vesti, činjenice i zaključke."
};

// per 1M tokens
const PRICING = {
  gemini: { input: 0.10, output: 0.40 },
  "gemini-lite": { input: 0.075, output: 0.30 },
  deepseek: { input: 0.14, output: 0.28 },
  ollama: { input: 0, output: 0 },
  custom: { input: 0, output: 0 }
};

// === Interni provider seam-ovi ===

function buildGeminiRequest(config, systemInstruction, userMessage, history) {
  const url = config.url.replace('{model}', config.model);
  const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
  const body = { contents, systemInstruction: { parts: [{ text: systemInstruction }] } };
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey };
  return { url, headers, body: JSON.stringify(body) };
}

function buildOpenAIRequest(config, systemInstruction, userMessage, history) {
  const url = config.url.replace('{model}', config.model);
  const messages = [{ role: "system", content: systemInstruction }];
  for (const h of history) {
    messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.parts[0].text });
  }
  messages.push({ role: "user", content: userMessage });
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  return { url, headers, body: JSON.stringify({ model: config.model, messages }) };
}

function parseGeminiResponse(result, config) {
  if (result.error) throw new Error(result.error.message);
  if (!result.candidates?.length) throw new Error("API nije vratio odgovor.");
  const text = result.candidates[0].content.parts[0].text;
  const meta = result.usageMetadata || {};
  const usage = calculateUsage(config.provider, config.model, meta.promptTokenCount, meta.candidatesTokenCount);
  return { text, usage };
}

function parseOpenAIResponse(result, config) {
  if (!result.choices?.length) throw new Error("API nije vratio odgovor.");
  const text = result.choices[0].message.content;
  const meta = result.usage || {};
  const usage = calculateUsage(config.provider, config.model, meta.prompt_tokens, meta.completion_tokens);
  return { text, usage };
}

function handleHttpError(response, provider) {
  if (response.status === 429) {
    throw new Error(`API Quota Exceeded (HTTP 429). Vaš limit za upite kod provajdera '${provider}' je potrošen. Pokušajte kasnije.`);
  }
}

// === Zajednička infrastruktura ===

async function updateGlobalUsage(usage) {
  const data = await browser.storage.local.get('total_usage');
  const u = data.total_usage || { tokens: 0, cost: 0 };
  u.tokens += usage.totalTokens;
  u.cost += parseFloat(usage.estimatedCost);
  await browser.storage.local.set({ total_usage: u });
}

function calculateUsage(provider, modelName, promptTokens = 0, outputTokens = 0) {
  let pricing;
  if (provider === 'gemini') {
    pricing = modelName.includes('lite') ? PRICING["gemini-lite"] : PRICING.gemini;
  } else {
    pricing = PRICING[provider] || PRICING.custom;
  }
  const costInput = (promptTokens / 1_000_000) * pricing.input;
  const costOutput = (outputTokens / 1_000_000) * pricing.output;
  const estimatedCost = (costInput + costOutput).toFixed(6);
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, estimatedCost };
}

function cleanJsonResponse(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

function buildSystemInstruction(transcript, taskSpec) {
  let prompt = `Transkript YouTube videa:\n${transcript}\n\nInstrukcija: ${taskSpec.instruction} Odgovaraj na srpskom jeziku.`;
  prompt += ` Obavezno zadrži približne vremenske oznake u formatu [MM:SS] iz originalnog transkripta kada referenciraš delove videa.`;
  if (taskSpec.persona && PERSONA_PROMPTS[taskSpec.persona]) {
    prompt += `\n\nTON I STIL: ${PERSONA_PROMPTS[taskSpec.persona]}`;
  }
  return prompt;
}

// === Glavni LLM request ===

async function llmRequest(config, systemInstruction, userMessage, history = []) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const isGemini = config.provider.startsWith('gemini');
    const { url, headers, body } = isGemini
      ? buildGeminiRequest(config, systemInstruction, userMessage, history)
      : buildOpenAIRequest(config, systemInstruction, userMessage, history);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      handleHttpError(response, config.provider);
      const errText = await response.text().catch(() => '');
      throw new Error(`${config.provider} API: HTTP ${response.status} — ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    return isGemini
      ? parseGeminiResponse(result, config)
      : parseOpenAIResponse(result, config);
  } finally {
    clearTimeout(timeoutId);
  }
}

// === Duboki task modul ===

async function llmTask(config, transcript, taskSpec) {
  const sysInst = buildSystemInstruction(transcript, taskSpec);
  const result = await llmRequest(config, sysInst, taskSpec.userMessage || "Generiši.", taskSpec.history || []);
  await updateGlobalUsage(result.usage);
  if (taskSpec.parseAs === 'json') {
    result.text = cleanJsonResponse(result.text);
  }
  return result;
}

// === Javne task funkcije ===

function llmSummarize(config, transcript, detailLevel, persona) {
  return llmTask(config, transcript, { instruction: DETAIL_PROMPTS[detailLevel], persona });
}

function llmExtractEntities(config, transcript) {
  return llmTask(config, transcript, {
    instruction: `Izvuci listu Alata, Tehnologija, Lokacija ili Osoba koji se pominju u videu. Vrati rezultat ISKLJUČIVO kao validan JSON niz stringova (npr. ["Alat 1", "Osoba 2"]). Ne piši nikakav drugi tekst.`,
    userMessage: "Generiši JSON.",
    parseAs: 'json'
  }).then(result => {
    try { return JSON.parse(result.text); }
    catch { console.error("Entity parse failed"); return []; }
  });
}

function llmQuiz(config, transcript) {
  return llmTask(config, transcript, {
    instruction: `Na osnovu ovog transkripta, generiši 3 do 5 pitanja sa višestrukim izborom kako bih proverio znanje. Vrati rezultat ISKLJUČIVO kao validan JSON niz objekata u sledećem formatu: [{"question": "Tekst pitanja", "options": ["A", "B", "C"], "answerIndex": 0}]. Ne piši nikakav dodatni tekst ili markdown.`,
    userMessage: "Generiši JSON kviz.",
    parseAs: 'json'
  });
}

function llmChat(config, transcript, history, userMessage) {
  return llmTask(config, transcript, {
    instruction: `Odgovaraj na pitanja korisnika na osnovu ovog transkripta na srpskom jeziku. Zadrži format [MM:SS] ako citiraš deo videa.`,
    userMessage,
    history
  });
}
