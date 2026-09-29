// prompts.js — Prompt construction (pure functions, no I/O)

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

function resolvePersona(personaValue, customPrompts = []) {
  if (typeof personaValue !== 'string') return 'standard';
  const match = personaValue.match(/^custom_(\d+)$/);
  if (match) {
    const prompt = customPrompts[Number(match[1])];
    if (typeof prompt?.text === 'string') return prompt.text;
  }
  return personaValue;
}

function buildSystemInstruction(transcript, taskSpec) {
  let prompt = `Transkript YouTube videa:\n${transcript}\n\n`;
  
  const outputLanguage = taskSpec.outputLanguage || 'English';

  if (taskSpec.chapters && taskSpec.chapters.length > 0) {
    prompt += `Zvanična poglavlja videa:\n`;
    taskSpec.chapters.forEach(c => {
      const min = Math.floor(c.timeSec / 60);
      const sec = Math.floor(c.timeSec % 60).toString().padStart(2, '0');
      prompt += `- [${min}:${sec}] ${c.title}\n`;
    });
    if (taskSpec.summary) prompt += `\nKoristi ova poglavlja da strukturiraš sažetak.\n`;
  }
  prompt += `Instrukcija: ${taskSpec.instruction} Odgovaraj na ${outputLanguage} jeziku (Respond in ${outputLanguage} language).`;
  if (taskSpec.summary) {
    prompt += ` Na početku stavi jednu rečenicu sa prefiksom 'TL;DR:' koja sažima ceo video.`;
  }
  if (taskSpec.parseAs !== 'json') {
    prompt += ` Zadrži postojeće vremenske oznake u formatu [MM:SS] kada referenciraš delove videa. Ne izmišljaj vremenske oznake.`;
  }
  if (taskSpec.persona && PERSONA_PROMPTS[taskSpec.persona]) {
    prompt += `\n\nTON I STIL: ${PERSONA_PROMPTS[taskSpec.persona]}`;
  } else if (taskSpec.persona && !Object.prototype.hasOwnProperty.call(PERSONA_PROMPTS, taskSpec.persona)) {
    prompt += `\n\nTON I STIL: ${taskSpec.persona}`;
  }
  return prompt;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DETAIL_PROMPTS, PERSONA_PROMPTS, resolvePersona, buildSystemInstruction };
}
