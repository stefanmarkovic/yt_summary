// Chat modul — owns chatHistory internally, ne leakuje stanje kao global

function initChat(config, transcript, messagesEl, inputEl, sendBtnEl) {
  const chatHistory = [];

  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message message-${role}`;
    setSafeHTML(msgDiv, markdownToHtml(text));
    messagesEl.appendChild(msgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !transcript || !config) return;

    inputEl.value = "";
    sendBtnEl.disabled = true;
    appendMessage('user', text);

    try {
      const result = await llmChat(config, transcript, chatHistory, text);
      appendMessage('model', result.text);
      chatHistory.push({ role: "user", parts: [{ text: text }] });
      chatHistory.push({ role: "model", parts: [{ text: result.text }] });
    } catch (e) {
      appendMessage('model', "Greška: " + e.message);
    } finally {
      sendBtnEl.disabled = false;
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
