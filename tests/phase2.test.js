const { renderSummaryCard } = require('../summary-renderer.js');
const { markdownToHtml, setSafeHTML, escapeHtml } = require('../markdown-renderer.js');
const { getLocalizedString } = require('../i18n.js');

beforeEach(() => {
  Object.assign(global, { markdownToHtml, setSafeHTML, escapeHtml, getLocalizedString });
  global.browser = { tabs: { create: jest.fn() } };
});

describe('Summary card production rendering', () => {
  test('extracts TL;DR once, renders body and counts actual words', () => {
    const container = document.createElement('div');
    const result = renderSummaryCard(container, { summary: '**TL;DR:** Short summary.\n\nDetailed content.' }, { uiLanguage: 'en' });
    expect(result).toMatchObject({ tldr: 'Short summary.', summaryText: 'Detailed content.', wordCount: 2, readTime: 1 });
    expect(container.querySelectorAll('.tldr-card')).toHaveLength(1);
    expect(container.querySelector('.summary-body').textContent).toBe('Detailed content.');
  });

  test('empty summaries have zero words and minutes', () => {
    expect(renderSummaryCard(document.createElement('div'), { summary: '' }, null)).toMatchObject({ wordCount: 0, readTime: 0 });
  });

  test('renders 450 words with three-minute reading time', () => {
    const result = renderSummaryCard(document.createElement('div'), { summary: Array(450).fill('word').join(' ') }, null);
    expect(result).toMatchObject({ wordCount: 450, readTime: 3 });
  });

  test('treats TL;DR, entities and model identifiers as text, including HTML payloads', () => {
    const container = document.createElement('div');
    renderSummaryCard(container, {
      summary: 'TL;DR: <img src=x onerror=alert(1)>\nBody',
      entities: ['<script>alert(1)</script>'], usage: {}
    }, { uiLanguage: 'sr', model: '<svg onload=alert(1)>' });
    expect(container.querySelector('img,script,[onload],[onerror]')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('Ulazni tokeni');
  });

  test.each(['https://youtu.be/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk&t=5s'])('timestamps preserve a valid URL for %s', url => {
    const container = document.createElement('div');
    renderSummaryCard(container, { summary: 'At [1:23] this happens.', videoUrl: url }, null);
    container.querySelector('.timestamp-link').click();
    const opened = new URL(browser.tabs.create.mock.calls[0][0].url);
    expect(opened.searchParams.get('t')).toBe('83s');
    expect(opened.searchParams.get('v')).toBe(new URL(url).searchParams.get('v'));
  });
});
