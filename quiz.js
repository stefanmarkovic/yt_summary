// Quiz rendering uses DOM text nodes: model output is never inserted as HTML.
/* exported handleGenerateQuiz */
let quizSequence = 0;

async function handleGenerateQuiz(config, transcript, messagesEl, buttonEl) {
  if (!transcript || !config || buttonEl.disabled) return;
  const localize = key => getLocalizedString(key, config.uiLanguage || 'en');
  const originalLabel = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = localize('quiz_generating');
  try {
    const result = await llmQuiz(config, transcript, config.outputLanguage || 'English');
    const questions = JSON.parse(result.text);
    if (!Array.isArray(questions) || questions.length === 0 || questions.some(q =>
      !q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length < 2 ||
      q.options.some(option => typeof option !== 'string') || !Number.isInteger(q.answerIndex) ||
      q.answerIndex < 0 || q.answerIndex >= q.options.length)) {
      throw new Error(localize('quiz_invalid'));
    }
    const quizId = ++quizSequence;
    const quizDiv = document.createElement('div');
    quizDiv.className = 'message message-model quiz-container';
    const heading = document.createElement('h3');
    heading.textContent = localize('quiz_title');
    quizDiv.appendChild(heading);
    const questionDivs = questions.map((question, questionIndex) => {
      const questionDiv = document.createElement('div');
      questionDiv.className = 'quiz-question';
      const text = document.createElement('p');
      text.textContent = `${questionIndex + 1}. ${question.question}`;
      questionDiv.appendChild(text);
      question.options.forEach((option, optionIndex) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `quiz-${quizId}-question-${questionIndex}`;
        input.value = optionIndex;
        label.append(input, document.createTextNode(' ' + option));
        questionDiv.appendChild(label);
      });
      quizDiv.appendChild(questionDiv);
      return questionDiv;
    });
    const submit = document.createElement('button');
    submit.className = 'secondary quiz-submit';
    submit.textContent = localize('quiz_check');
    quizDiv.appendChild(submit);
    messagesEl.appendChild(quizDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    submit.addEventListener('click', () => {
      let score = 0;
      questions.forEach((question, index) => {
        const questionDiv = questionDivs[index];
        const selected = questionDiv.querySelector('input:checked');
        const chosen = selected ? Number(selected.value) : null;
        if (chosen === question.answerIndex) score++;
        questionDiv.querySelectorAll('input').forEach((input, optionIndex) => {
          input.disabled = true;
          const isAnswer = optionIndex === question.answerIndex;
          const isChosen = optionIndex === chosen;
          if (!isAnswer && !isChosen) return;
          const tag = document.createElement('span');
          tag.className = 'quiz-tag';
          tag.textContent = isChosen
            ? `${isAnswer ? '✓' : '✗'} ${localize('quiz_your_answer')}`
            : `✓ ${localize('quiz_correct_answer')}`;
          input.parentElement.classList.add(isAnswer ? 'quiz-correct' : 'quiz-wrong');
          input.parentElement.appendChild(tag);
        });
        if (chosen === null) {
          const unanswered = document.createElement('p');
          unanswered.className = 'quiz-unanswered';
          unanswered.textContent = localize('quiz_unanswered');
          questionDiv.appendChild(unanswered);
        }
      });
      const scoreEl = document.createElement('div');
      scoreEl.className = 'quiz-score';
      scoreEl.textContent = `${localize('quiz_score')}: ${score}/${questions.length}`;
      submit.replaceWith(scoreEl);
    });
  } catch (error) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message message-model';
    errorDiv.textContent = localize('quiz_error') + error.message;
    messagesEl.appendChild(errorDiv);
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleGenerateQuiz };
}
