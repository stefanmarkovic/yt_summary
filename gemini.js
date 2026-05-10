// Shared Gemini API logic — koristi se u popup.js i result.js

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DETAIL_PROMPTS = {
  "1": "Kratak rezime.",
  "2": "Srednji rezime sa buletima.",
  "3": "Veoma detaljan rezime."
};

// gemini-3-flash-preview: $0.10/1M input, $0.40/1M output
const GEMINI_PRICING = { input: 0.10, output: 0.40 };

async function geminiRequest(apiKey, contents) {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents })
  });
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);

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
}
