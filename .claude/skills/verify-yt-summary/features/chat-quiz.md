# Chat and quiz

Below the summary, the user can ask questions about the video. Each question is answered from the transcript with the running conversation as context. **Generate Quiz** builds a 3–5 question multiple-choice quiz the user can answer and score.

## Sub-features

- `chat-send` `#chat-send-btn`, or Enter in `#chat-input`, appends the user message and the model answer to `#chat-messages`.
- `chat-history` a follow-up question sends the earlier turns as history.
- `chat-error` an LLM failure renders `Greška: <message>` as a model message.
- `quiz-generate` `#generate-quiz-btn` renders a `.quiz-container` with radio options and a `.quiz-submit` button.
- `quiz-score` checking answers colors right and wrong options, disables the inputs and shows `Score: n/N`.
- `quiz-invalid` malformed quiz JSON renders the quiz error message instead of a quiz.

## How to get to it (user POV)

- On the result page, type in **Ask AI about the video** and press **Send** or Enter.
- On the result page, click **Generate Quiz**.

## Driving it with ytv

Preconditions:

- A result tab from the [summarize](./summarize.md) journey in this run, with a transcript (the buttons are disabled without one).

- **Ask.** Run `node $Y type result.html '#chat-input' 'What is the video about?'` and `node $Y click result.html '#chat-send-btn'`. Then run `node $Y wait result.html "document.querySelectorAll('#chat-messages .message-model').length >= 1"`. `.message-user` shows the question, and `.message-model` shows `[ytv-stub] answer to: What is the video about?`.
- **Follow-up.** Ask a second question the same way. `llm-log` shows two `chat` tasks. The stub does not echo history, so assert two model messages, in order.
- **Quiz.** Run `node $Y click result.html '#generate-quiz-btn'` and `node $Y wait result.html "document.querySelector('.quiz-container .quiz-submit')"`. There are 2 `.quiz-question` blocks, and `llm-log` shows a `quiz` task.
- **Score.** Run `node $Y eval result.html "(() => { const qs = document.querySelectorAll('.quiz-question'); qs[0].querySelectorAll('input')[0].click(); qs[1].querySelectorAll('input')[0].click(); document.querySelector('.quiz-submit').click(); return document.querySelector('.quiz-submit').textContent; })()"`. It returns `Score: 1/2`, and every input is disabled.
- **Proof.** Run `node $Y shot result.html chat-quiz`.

## Gotchas

- Enter-to-send needs a real key event, which extension pages cannot get here. Only the button path is driven. Report Enter as not verified.
- Radio choices are made with `el.click()` inside one `eval`, for the same privileged-scope reason.
- In `--llm live` the quiz depends on the model returning strict JSON. A `quiz-invalid` message there may be model output, not a regression. Compare with the stub run.
