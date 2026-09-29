// Chat modul — owns chatHistory internally, ne leakuje stanje kao global
/* exported initChat */

function initChat(config, transcript, messagesEl, inputEl, sendBtnEl) {
  const chatHistory = [];
  let sending = false;
  const available = Boolean(config && transcript);
  inputEl.disabled = !available;
  sendBtnEl.disabled = !available;

  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message message-${role}`;
    setSafeHTML(msgDiv, markdownToHtml(text));
    messagesEl.appendChild(msgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !available || sending) return;

    sending = true;
    inputEl.value = "";
    sendBtnEl.disabled = true;
    appendMessage('user', text);

    try {
      const result = await llmChat(config, transcript, chatHistory, text);
      appendMessage('model', result.text);
      chatHistory.push({ role: "user", parts: [{ text: text }] });
      chatHistory.push({ role: "model", parts: [{ text: result.text }] });
    } catch (e) {
      appendMessage('model', getLocalizedString('status_error', config.uiLanguage || 'en') + e.message);
    } finally {
      sendBtnEl.disabled = false;
      sending = false;
    }
  }

  // Wire event listeners
  sendBtnEl.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initChat };
}
