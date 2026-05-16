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
  if (personaValue.startsWith('custom_')) {
    const idx = parseInt(personaValue.replace('custom_', ''));
    if (customPrompts[idx]) return customPrompts[idx].text;
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
    prompt += `\nInstrukcija: Koristi ova poglavlja da strukturiraš sažetak. ${taskSpec.instruction} Na početku uvek stavi jednu rečenicu sa prefiksom 'TL;DR:' koja sažima ceo video. Odgovaraj na ${outputLanguage} jeziku (Respond in ${outputLanguage} language).`;
  } else {
    prompt += `Instrukcija: ${taskSpec.instruction} Na početku uvek stavi jednu rečenicu sa prefiksom 'TL;DR:' koja sažima ceo video. Odgovaraj na ${outputLanguage} jeziku (Respond in ${outputLanguage} language).`;
  }

  prompt += ` Obavezno zadrži približne vremenske oznake u formatu [MM:SS] iz originalnog transkripta kada referenciraš delove videa.`;
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
