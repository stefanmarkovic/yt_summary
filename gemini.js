// Shared LLM API logic (Gemini, DeepSeek, Ollama)

const LLM_TIMEOUT_MS = 90_000;

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

// Global usage updater
async function updateGlobalUsage(usage) {
  const data = await browser.storage.local.get('total_usage');
  const u = data.total_usage || { tokens: 0, cost: 0 };
  u.tokens += usage.totalTokens;
  u.cost += parseFloat(usage.estimatedCost);
  await browser.storage.local.set({ total_usage: u });
}

function getSystemInstruction(transcript, taskPrompt, persona = "standard") {
  let prompt = `Transkript YouTube videa:\n${transcript}\n\nInstrukcija: ${taskPrompt} Odgovaraj na srpskom jeziku.`;
  prompt += ` Obavezno zadrži približne vremenske oznake u formatu [MM:SS] iz originalnog transkripta kada referenciraš delove videa.`;
  if (PERSONA_PROMPTS[persona]) {
    prompt += `\n\nTON I STIL: ${PERSONA_PROMPTS[persona]}`;
  }
  return prompt;
}

async function llmSummarize(config, transcript, detailLevel, persona) {
  const sysInst = getSystemInstruction(transcript, DETAIL_PROMPTS[detailLevel], persona);
  const result = await llmRequest(config, sysInst, "Generiši sažetak.");
  await updateGlobalUsage(result.usage);
  return result;
}

async function llmExtractEntities(config, transcript) {
  const sysInst = `Ovo je transkript YouTube videa:\n${transcript}\n\nIzvuci listu Alata, Tehnologija, Lokacija ili Osoba koji se pominju u videu. Vrati rezultat ISKLJUČIVO kao validan JSON niz stringova (npr. ["Alat 1", "Osoba 2"]). Ne piši nikakav drugi tekst.`;
  try {
    const result = await llmRequest(config, sysInst, "Generiši JSON.");
    await updateGlobalUsage(result.usage);
    let text = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error("Entity extraction failed:", e);
    return [];
  }
}

async function llmQuiz(config, transcript) {
  const sysInst = `Ovo je transkript YouTube videa:\n${transcript}\n\nNa osnovu ovog transkripta, generiši 3 do 5 pitanja sa višestrukim izborom kako bih proverio znanje. Vrati rezultat ISKLJUČIVO kao validan JSON niz objekata u sledećem formatu: [{"question": "Tekst pitanja", "options": ["A", "B", "C"], "answerIndex": 0}]. Ne piši nikakav dodatni tekst ili markdown.`;
  const result = await llmRequest(config, sysInst, "Generiši JSON kviz.");
  await updateGlobalUsage(result.usage);
  return result;
}

async function llmFormatTranscript(config, transcript) {
  const sysInst = `Ovo je auto-generisan transkript YouTube videa:\n${transcript}\n\nTvoj zadatak je da prođeš kroz ovaj transkript i ispraviš isključivo najočiglednije greške u generisanju (dodaj interpunkciju, velika slova, ispravi tipografske greške nastale lošim prepoznavanjem govora). Zadrži [MM:SS] vremenske oznake ako postoje. NIKAKO i ni pod kojim uslovima ne smeš da menjaš smisao ni jedne jedine rečenice, da dodaješ nove informacije ili da skraćuješ tekst. Vrati ispravljen transkript kao čist tekst bez ikakvih dodatnih komentara.`;
  const result = await llmRequest(config, sysInst, "Ispravi i formatiraj transkript.");
  await updateGlobalUsage(result.usage);
  return result;
}

async function llmChat(config, transcript, history, userMessage) {
  const sysInst = `Ovo je transkript YouTube videa:\n${transcript}\n\nOdgovaraj na pitanja korisnika na osnovu ovog transkripta na srpskom jeziku. Zadrži format [MM:SS] ako citiraš deo videa.`;
  const result = await llmRequest(config, sysInst, userMessage, history);
  await updateGlobalUsage(result.usage);
  return result;
}

async function llmRequest(config, systemInstruction, userMessage, history = []) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    let response;
    let url = config.url.replace('{model}', config.model);
    
    // Google AI Studio (Gemini) Format
    if (config.provider.startsWith('gemini')) {
      const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
      const body = { contents, systemInstruction: { parts: [{ text: systemInstruction }] } };
      
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 429) {
          throw new Error(`API Quota Exceeded (HTTP 429). Vaš besplatni limit za upite za ovaj model je potrošen. Sačekajte malo ili proverite vaš nalog.`);
        }
        throw new Error(`Gemini API: HTTP ${response.status} — ${errText.substring(0, 200)}`);
      }

      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      if (!result.candidates?.length) throw new Error("API nije vratio odgovor.");

      const text = result.candidates[0].content.parts[0].text;
      const meta = result.usageMetadata || {};
      const usage = calculateUsage(config.provider, config.model, meta.promptTokenCount, meta.candidatesTokenCount);
      return { text, usage };

    } else {
      // OpenAI Compatible Format (DeepSeek, Ollama, Custom)
      const messages = [{ role: "system", content: systemInstruction }];
      for (const h of history) {
        messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.parts[0].text });
      }
      messages.push({ role: "user", content: userMessage });

      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

      const body = { model: config.model, messages };
      
      if(config.provider === 'deepseek') {
          // deepseek wants explicit max_tokens sometimes, but omit for now
      }

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 429) {
          throw new Error(`API Quota Exceeded (HTTP 429). Vaš limit za upite kod provajdera '${config.provider}' je potrošen. Pokušajte kasnije.`);
        }
        throw new Error(`${config.provider} API: HTTP ${response.status} — ${errText.substring(0, 200)}`);
      }

      const result = await response.json();
      if (!result.choices?.length) throw new Error("API nije vratio odgovor.");

      const text = result.choices[0].message.content;
      const meta = result.usage || {};
      const usage = calculateUsage(config.provider, config.model, meta.prompt_tokens, meta.completion_tokens);
      return { text, usage };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function calculateUsage(provider, modelName, promptTokens = 0, outputTokens = 0) {
  let pricing;
  if (provider === 'gemini') {
    if (modelName.includes('lite')) {
      pricing = PRICING["gemini-lite"];
    } else {
      pricing = PRICING.gemini;
    }
  } else {
    pricing = PRICING[provider] || PRICING.custom;
  }
  
  const costInput = (promptTokens / 1_000_000) * pricing.input;
  const costOutput = (outputTokens / 1_000_000) * pricing.output;
  const estimatedCost = (costInput + costOutput).toFixed(6);
  return { promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, estimatedCost };
}
