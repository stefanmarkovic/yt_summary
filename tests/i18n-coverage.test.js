const fs = require('fs');
const path = require('path');
const { I18N } = require('../i18n.js');

describe('Translation Coverage (i18n)', () => {
  const htmlFiles = ['popup.html', 'result.html', 'playlist.html'];
  const keys = new Set();

  beforeAll(() => {
    htmlFiles.forEach(file => {
      const p = path.join(__dirname, '..', file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const matches = content.matchAll(/data-i18n="([^"]+)"/g);
        for (const match of matches) {
          keys.add(match[1]);
        }
      }
    });
  });

  const languages = ['en', 'sr', 'de', 'es'];

  languages.forEach(lang => {
    describe(`Language: ${lang}`, () => {
      test('has I18N object defined', () => {
        expect(I18N[lang]).toBeDefined();
      });

      test('contains all keys found in HTML files', () => {
        const missingKeys = [];
        keys.forEach(key => {
          if (!I18N[lang] || !I18N[lang][key]) {
            missingKeys.push(key);
          }
        });
        
        expect(missingKeys).toEqual([]);
      });
    });
  });
});