const { buildSystemInstruction } = require('../gemini.js');

describe('Phase 3 Advanced Features', () => {
  test('buildSystemInstruction parses CUSTOM: persona correctly', () => {
    // Mock the global PERSONA_PROMPTS for testing if needed
    global.PERSONA_PROMPTS = {
      "standard": "",
      "skeptic": "Test skeptic"
    };

    const transcript = "Test transcript";
    const taskSpec = {
      instruction: "Summarize this.",
      persona: "CUSTOM:You are a pirate. Arrr.",
      outputLanguage: "English"
    };

    const prompt = buildSystemInstruction(transcript, taskSpec);
    expect(prompt).toContain('TON I STIL: You are a pirate. Arrr.');
    expect(prompt).not.toContain('CUSTOM:'); // Make sure the prefix was stripped
  });
});