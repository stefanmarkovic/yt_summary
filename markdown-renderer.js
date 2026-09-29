// Markdown → HTML renderer (pure function, zero dependencies)
/* exported markdownToHtml, setSafeHTML, escapeHtml */

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function markdownToHtml(md) {
  let html = String(md ?? '').split('\u0000').join('').replace(/\r\n?/g, '\n');
  // Sanitizacija: escape HTML pre markdown transformacija
  html = escapeHtml(html);
  // Protect code before applying emphasis and timestamp transformations.
  const codeBlocks = [];
  html = html.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
    const token = `\u0000CODE${codeBlocks.length}\u0000`;
    codeBlocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\n\n${token}\n\n`;
  }).replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeBlocks.length}\u0000`;
    codeBlocks.push(`<code>${code}</code>`);
    return token;
  });
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/^---$/gm, '<hr>');
  // Ordered list items use a temporary <OLI> tag to disambiguate from unordered <li>
  // during regex processing, then get converted to real <li> inside <ol> below.
  html = html.replace(/^\d+\. (.+)$/gm, '<OLI>$1</OLI>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/((<OLI>.*<\/OLI>\n?)+)/g, (match) =>
    '<ol>' + match.replace(/<(\/?)OLI>/g, '<$1li>') + '</ol>');
  html = html.replace(/\n\n+/g, '\n\n');
  html = html.split('\n\n').map(block => {
    block = block.trim();
    if (!block) return '';
    const isCodeBlock = codeBlocks.some((code, index) => code.startsWith('<pre>') && block === `\u0000CODE${index}\u0000`);
    if (isCodeBlock || block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') ||
        block.startsWith('<blockquote') || block.startsWith('<hr') || block.startsWith('<li')) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Timestamps [MM:SS] -> clickable links
  html = html.replace(/\[(\d{1,3}):([0-5]\d)\]/g, '<a href="#" class="timestamp-link" data-time="$1:$2">[$1:$2]</a>');
  // The NUL delimiters are internal placeholders, never text supplied as a pattern.
  // eslint-disable-next-line no-control-regex
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeBlocks[index]);

  return html;
}

function setSafeHTML(element, htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  // DOMParser alone is not a sanitizer: event handlers survive insertion.
  const allowedTags = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'blockquote', 'hr', 'br', 'strong', 'em', 'code', 'pre', 'a', 'svg', 'path', 'polyline', 'circle', 'rect', 'polygon']);
  doc.body.querySelectorAll('*').forEach(node => {
    if (!allowedTags.has(node.tagName.toLowerCase())) {
      node.remove();
      return;
    }
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'src' || name === 'xlink:href' ||
          (name === 'href' && !/^(?:https?:\/\/|#)/i.test(attribute.value))) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  element.replaceChildren(...doc.body.childNodes);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { markdownToHtml, setSafeHTML, escapeHtml };
}
