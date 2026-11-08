const { initChat } = require('../chat.js');
const { handleGenerateQuiz } = require('../quiz.js');
const { markdownToHtml, setSafeHTML } = require('../markdown-renderer.js');
const { getLocalizedString } = require('../i18n.js');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  Object.assign(global, { markdownToHtml, setSafeHTML, getLocalizedString });
  document.body.innerHTML = '<div id="messages"></div><textarea id="input"></textarea><button id="send">Send</button><button id="quiz">Generate Quiz</button>';
});

test('chat prevents concurrent Enter requests and supplies completed history to the next message', async () => {
  let resolveFirst;
  global.llmChat = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue({ text: 'Second answer' });
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  initChat({ uiLanguage: 'en' }, 'Transcript', document.getElementById('messages'), input, send);
  input.value = 'First';
  send.click();
  input.value = 'Second';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(llmChat).toHaveBeenCalledTimes(1);
  resolveFirst({ text: 'First answer' });
  await flush();
  send.click();
  await flush();
  expect(llmChat.mock.calls[1][2]).toEqual(expect.arrayContaining([
    { role: 'user', parts: [{ text: 'First' }] },
    { role: 'model', parts: [{ text: 'First answer' }] }
  ]));
  expect(llmChat.mock.calls[1][3]).toBe('Second');
});

test('multiple quizzes keep independent radio groups and render model text literally', async () => {
  global.llmQuiz = jest.fn().mockResolvedValue({ text: JSON.stringify([{ question: '<img src=x>', options: ['<svg onload=x>', 'Correct'], answerIndex: 1 }]) });
  const messages = document.getElementById('messages');
  const button = document.getElementById('quiz');
  await handleGenerateQuiz({ uiLanguage: 'en' }, 'Transcript', messages, button);
  await handleGenerateQuiz({ uiLanguage: 'en' }, 'Transcript', messages, button);
  const quizzes = messages.querySelectorAll('.quiz-container');
  const first = quizzes[0].querySelectorAll('input')[1];
  const second = quizzes[1].querySelectorAll('input')[1];
  first.click(); second.click();
  expect(first.checked).toBe(true);
  expect(second.checked).toBe(true);
  expect(first.name).not.toBe(second.name);
  expect(messages.querySelector('img,svg')).toBeNull();
  quizzes[0].querySelector('.quiz-submit').click();
  expect(quizzes[0].querySelector('.quiz-submit').textContent).toBe('Score: 1/1');
  expect(first.disabled).toBe(true);
  expect(button.textContent).toBe('Generate Quiz');
});

test('invalid quiz schema produces a message and restores its button', async () => {
  global.llmQuiz = jest.fn().mockResolvedValue({ text: JSON.stringify([{ question: 'Bad', options: ['Only'], answerIndex: 4 }]) });
  const button = document.getElementById('quiz');
  await handleGenerateQuiz({ uiLanguage: 'en' }, 'Transcript', document.getElementById('messages'), button);
  expect(document.querySelector('.quiz-container')).toBeNull();
  expect(document.getElementById('messages').textContent).toContain('invalid quiz');
  expect(button.disabled).toBe(false);
});

test('chat and quiz answer in the configured output language', async () => {
  global.llmChat = jest.fn().mockResolvedValue({ text: 'Odgovor' });
  global.llmQuiz = jest.fn().mockResolvedValue({ text: JSON.stringify([{ question: 'Q', options: ['A', 'B'], answerIndex: 0 }]) });
  const config = { uiLanguage: 'sr', outputLanguage: 'Srpski' };
  const input = document.getElementById('input');
  initChat(config, 'Transcript', document.getElementById('messages'), input, document.getElementById('send'));
  input.value = 'Zašto?';
  document.getElementById('send').click();
  await flush();
  await handleGenerateQuiz(config, 'Transcript', document.getElementById('messages'), document.getElementById('quiz'));
  expect(llmChat.mock.calls[0][4]).toBe('Srpski');
  expect(llmQuiz.mock.calls[0][2]).toBe('Srpski');
});
