const { getLocalizedString, localizePage, I18N } = require('../i18n.js');

describe('i18n', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <span id="title" data-i18n="app_title">Default Title</span>
        <button id="btn" data-i18n="btn_save">Default Button</button>
        <input id="input" type="text" data-i18n="api_key_placeholder" placeholder="Default Placeholder" />
        <input id="btn_input" type="button" data-i18n="btn_close" value="Default Close" />
      </div>
    `;
  });

  test('getLocalizedString returns correct string for requested language', () => {
    expect(getLocalizedString('app_title', 'en')).toBe('YT Summary AI');
    expect(getLocalizedString('btn_save', 'sr')).toBe('Sačuvaj');
    expect(getLocalizedString('btn_save', 'de')).toBe('Speichern');
  });

  test('getLocalizedString fallbacks to key if not found', () => {
    expect(getLocalizedString('non_existent_key', 'sr')).toBe('non_existent_key');
  });

  test('localizePage updates DOM elements correctly based on language', () => {
    localizePage('sr');
    
    const title = document.getElementById('title');
    const btn = document.getElementById('btn');
    const input = document.getElementById('input');
    const btnInput = document.getElementById('btn_input');

    expect(title.textContent).toBe('YT Summary AI');
    expect(btn.textContent).toBe('Sačuvaj');
    expect(input.getAttribute('placeholder')).toBe('Unesite ključ (opciono za lokalne)');
    expect(btnInput.value).toBe('Zatvori');
  });
});
