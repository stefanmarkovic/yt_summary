// Shared Gemini API logic — koristi se u popup.js i result.js

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 60_000;

const DETAIL_PROMPTS = {
  "1": "Kratak rezime.",
  "2": "Srednji rezime sa buletima.",
  "3": "Veoma detaljan rezime."
};

// gemini-3-flash-preview: $0.10/1M input, $0.40/1M output
const GEMINI_PRICING = { input: 0.10, output: 0.40 };

async function geminiSummarize(apiKey, transcript, detailLevel) {
  const contents = [{ parts: [{ text: `Transkript: ${transcript}\n\nInstrukcija: ${DETAIL_PROMPTS[detailLevel]} na srpskom jeziku.` }] }];
  return await geminiRequest(apiKey, contents);
}

async function geminiChat(apiKey, transcript, history, userMessage) {
  const systemInstruction = {
    parts: [{ text: `Ovo je transkript YouTube videa: ${transcript}\n\nOdgovaraj na pitanja na osnovu ovog transkripta na srpskom jeziku.` }]
  };
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userMessage }] }
  ];
  return await geminiRequest(apiKey, contents, systemInstruction);
}

async function geminiRequest(apiKey, contents, systemInstruction = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Gemini API: HTTP ${response.status} — ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    if (!result.candidates?.length) {
      throw new Error("Gemini nije vratio odgovor (moguć safety filter).");
    }

    const text = result.candidates[0].content.parts[0].text;
    const meta = result.usageMetadata || {};
    const promptTokens = meta.promptTokenCount || 0;
    const outputTokens = meta.candidatesTokenCount || 0;
    const totalTokens = meta.totalTokenCount || (promptTokens + outputTokens);
    const costInput = (promptTokens / 1_000_000) * GEMINI_PRICING.input;
    const costOutput = (outputTokens / 1_000_000) * GEMINI_PRICING.output;
    const estimatedCost = (costInput + costOutput).toFixed(6);

    return {
      text,
      usage: { promptTokens, outputTokens, totalTokens, estimatedCost }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
