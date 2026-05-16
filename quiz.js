// Quiz modul — generisanje kviza, renderovanje, provera odgovora
/* exported handleGenerateQuiz */

async function handleGenerateQuiz(config, transcript, messagesEl, buttonEl) {
  if (!transcript || !config) return;
  buttonEl.disabled = true;
  buttonEl.textContent = "Generisanje...";

  try {
    const result = await llmQuiz(config, transcript);
    const questions = JSON.parse(result.text);

    const quizDiv = document.createElement('div');
    quizDiv.className = `message message-model quiz-container`;
    quizDiv.style.cssText = "background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);";

    let html = `<h3 style="margin-top:0; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">Kviz znanja</h3>`;

    questions.forEach((q, qIndex) => {
      html += `<div class="quiz-question" style="margin-bottom: 15px;">
        <p style="font-weight: bold; margin-bottom: 8px;">${qIndex + 1}. ${q.question}</p>`;
      q.options.forEach((opt, oIndex) => {
        html += `<label style="display:block; margin-bottom: 4px; font-size: 13px; cursor: pointer;">
          <input type="radio" name="q${qIndex}" value="${oIndex}"> ${opt}
        </label>`;
      });
      html += `</div>`;
    });

    html += `<button id="submit-quiz-btn" class="secondary" style="margin-top: 10px;">Proveri odgovore</button>`;

    setSafeHTML(quizDiv, html);
    messagesEl.appendChild(quizDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Check answers listener
    quizDiv.querySelector('#submit-quiz-btn').addEventListener('click', (e) => {
      let score = 0;
      questions.forEach((q, qIndex) => {
        const selected = quizDiv.querySelector(`input[name="q${qIndex}"]:checked`);
        const qDiv = quizDiv.querySelectorAll('.quiz-question')[qIndex];

        if (selected) {
          const sIndex = parseInt(selected.value);
          if (sIndex === q.answerIndex) {
            score++;
            selected.parentElement.style.color = "#4ade80"; // green
          } else {
            selected.parentElement.style.color = "#f87171"; // red
            // Highlight correct one
            qDiv.querySelectorAll('label')[q.answerIndex].style.color = "#4ade80";
          }
        } else {
          qDiv.querySelectorAll('label')[q.answerIndex].style.color = "#4ade80";
        }
      });
      e.target.textContent = `Rezultat: ${score}/${questions.length}`;
      e.target.disabled = true;
    });

  } catch (e) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message message-model';
    errorDiv.textContent = "Greška pri generisanju kviza: " + e.message;
    messagesEl.appendChild(errorDiv);
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = "🎲 Generiši kviz";
  }
}
