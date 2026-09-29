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
