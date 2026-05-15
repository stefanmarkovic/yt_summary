// Markdown → HTML renderer (pure function, zero dependencies)

function markdownToHtml(md) {
  let html = md;
  // Sanitizacija: escape HTML pre markdown transformacija
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\d+\. (.+)$/gm, '<OLI>$1</OLI>');
  html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/((<OLI>.*<\/OLI>\n?)+)/g, (match) =>
    '<ol>' + match.replace(/OLI/g, 'li') + '</ol>');
  html = html.replace(/\n\n+/g, '\n\n');
  html = html.split('\n\n').map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') ||
        block.startsWith('<blockquote') || block.startsWith('<hr') || block.startsWith('<li')) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Timestamps [MM:SS] -> clickable links
  html = html.replace(/\[(\d{1,3}):(\d{2})\]/g, '<a href="#" class="timestamp-link" data-time="$1:$2">[$1:$2]</a>');

  return html;
}

function setSafeHTML(element, htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  element.replaceChildren(...doc.body.childNodes);
}
