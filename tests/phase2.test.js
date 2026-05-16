describe('Phase 2 Content Enhancements', () => {
  test('TL;DR parsing regex extracts correctly', () => {
    const summaryText = "TL;DR: This is a short summary.\n\nHere is the detailed content.";
    const tldrMatch = summaryText.match(/TL;DR:\s*(.*?)(\n|$)/i);
    
    expect(tldrMatch).not.toBeNull();
    expect(tldrMatch[1]).toBe("This is a short summary.");
    
    const remainingText = summaryText.replace(tldrMatch[0], '').trim();
    expect(remainingText).toBe("Here is the detailed content.");
  });

  test('TL;DR parsing handles case insensitivity', () => {
    const summaryText = "tl;dr: Case insensitive.\nContent";
    const tldrMatch = summaryText.match(/TL;DR:\s*(.*?)(\n|$)/i);
    
    expect(tldrMatch).not.toBeNull();
    expect(tldrMatch[1]).toBe("Case insensitive.");
  });

  test('Reading time calculation', () => {
    const text = new Array(450).fill("word").join(" ");
    const wordCount = text.split(/\s+/).length;
    const readTime = Math.ceil(wordCount / 200);
    
    expect(wordCount).toBe(450);
    expect(readTime).toBe(3);
  });
});