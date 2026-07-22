describe('HTML Sanitization in Transcript Fetcher (CodeQL #4)', () => {
  function stripHtmlTags(input) {
    let previous;
    do {
      previous = input;
      input = input.replace(/<[^>]*>/g, '');
    } while (input !== previous);
    return input.replace(/<|>/g, '');
  }

  test('removes standard HTML tags', () => {
    expect(stripHtmlTags('Hello <b>world</b>')).toBe('Hello world');
    expect(stripHtmlTags('<span>Line 1</span><br><span>Line 2</span>')).toBe('Line 1Line 2');
  });

  test('iteratively sanitizes nested HTML tags preventing injection', () => {
    const maliciousInput = '<scrip<script>is removed</script>t>Hello';
    expect(stripHtmlTags(maliciousInput)).toBe('is removedtHello');
  });

  test('handles nested script tags and removes orphaned brackets', () => {
    const nestedScript = '<script<script>>alert(123)</script>';
    expect(stripHtmlTags(nestedScript)).toBe('alert(123)');
  });

  test('handles text without HTML tags', () => {
    const text = 'Simple transcript text without formatting';
    expect(stripHtmlTags(text)).toBe(text);
  });
});
