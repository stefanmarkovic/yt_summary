const { markdownToHtml, setSafeHTML } = require('../markdown-renderer.js');

describe('Markdown renderer', () => {
  test('escapes raw HTML and preserves literal content in ordered lists', () => {
    const container = document.createElement('div');
    setSafeHTML(container, markdownToHtml('1. OLIVE and POLICE\n2. <img src=x onerror=alert(1)>'));
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.textContent).toContain('OLIVE and POLICE');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  test('code keeps emphasis and timestamps literal', () => {
    const container = document.createElement('div');
    setSafeHTML(container, markdownToHtml('`**literal** [1:23]`\n\n```js\nconst x = "<script>"; // **bold** [1:23]\n```'));
    expect(container.querySelectorAll('code')).toHaveLength(2);
    expect(container.querySelector('pre code').textContent).toContain('<script>');
    expect(container.querySelector('strong,.timestamp-link')).toBeNull();
  });

  test('ignores invalid timestamp seconds and handles empty values', () => {
    expect(markdownToHtml(undefined)).toBe('');
    expect(markdownToHtml('[1:99]')).not.toContain('timestamp-link');
  });

  test('safe HTML removes active elements, event handlers and unsafe URLs while keeping static graphics', () => {
    const container = document.createElement('div');
    setSafeHTML(container, '<script>alert(1)</script><iframe srcdoc=x></iframe><p onclick=x>Text</p><a href="javascript:alert(1)">Link</a><svg><path d="M1 1"/><animate attributeName="href" values="javascript:x"/></svg>');
    expect(container.querySelector('script,iframe,animate,[onclick]')).toBeNull();
    expect(container.querySelector('a').hasAttribute('href')).toBe(false);
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(container.textContent).toBe('TextLink');
  });
});

describe('Markdown lists as LLMs emit them', () => {
  test('italic text inside an asterisk bullet keeps both the list and the emphasis', () => {
    const container = document.createElement('div');
    setSafeHTML(container, markdownToHtml('* item with *emphasis* here\n* second'));
    expect([...container.querySelectorAll('ul > li')].map(li => li.textContent)).toEqual(['item with emphasis here', 'second']);
    expect(container.querySelector('li em').textContent).toBe('emphasis');
    expect(container.querySelector('p ul')).toBeNull();
  });

  test('indented sub-bullets render as list items instead of raw asterisks', () => {
    const container = document.createElement('div');
    setSafeHTML(container, markdownToHtml('* **Topic:**\n    * detail one\n    * detail two\n* next'));
    expect([...container.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Topic:', 'detail one', 'detail two', 'next']);
    expect(container.textContent).not.toContain('*');
  });

  test('a lone asterisk between spaces stays literal', () => {
    expect(markdownToHtml('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  });
});
