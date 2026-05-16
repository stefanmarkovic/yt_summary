const { buildSystemInstruction, resolvePersona } = require('../prompts.js');

describe('Phase 3 Advanced Features', () => {
  test('buildSystemInstruction applies custom persona text directly', () => {
    const transcript = "Test transcript";
    const taskSpec = {
      instruction: "Summarize this.",
      persona: "You are a pirate. Arrr.",
      outputLanguage: "English"
    };

    const prompt = buildSystemInstruction(transcript, taskSpec);
    expect(prompt).toContain('TON I STIL: You are a pirate. Arrr.');
  });

  test('buildSystemInstruction applies standard persona from PERSONA_PROMPTS', () => {
    const transcript = "Test transcript";
    const taskSpec = {
      instruction: "Summarize this.",
      persona: "skeptic",
      outputLanguage: "English"
    };

    const prompt = buildSystemInstruction(transcript, taskSpec);
    expect(prompt).toContain('TON I STIL:');
    expect(prompt).toContain('skeptik');
  });

  test('buildSystemInstruction omits TON I STIL for standard persona', () => {
    const transcript = "Test transcript";
    const taskSpec = {
      instruction: "Summarize this.",
      persona: "standard",
      outputLanguage: "English"
    };

    const prompt = buildSystemInstruction(transcript, taskSpec);
    expect(prompt).not.toContain('TON I STIL');
  });

  test('resolvePersona returns standard key as-is', () => {
    expect(resolvePersona('standard')).toBe('standard');
    expect(resolvePersona('skeptic')).toBe('skeptic');
  });

  test('resolvePersona resolves custom_ prefix to prompt text', () => {
    const customPrompts = [
      { name: 'Pirate', text: 'You are a pirate. Arrr.' },
      { name: 'Chef', text: 'You are a chef.' }
    ];
    expect(resolvePersona('custom_0', customPrompts)).toBe('You are a pirate. Arrr.');
    expect(resolvePersona('custom_1', customPrompts)).toBe('You are a chef.');
  });

  test('resolvePersona returns original value for invalid custom index', () => {
    expect(resolvePersona('custom_99', [])).toBe('custom_99');
  });
});