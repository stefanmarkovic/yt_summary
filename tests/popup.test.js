const fs = require('fs');
const path = require('path');

describe('Popup UI interactions', () => {
  beforeEach(() => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
    document.body.innerHTML = html;
    
    // Mock browser extension APIs
    global.browser = {
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({
            llm_config: { apiKey: '123', provider: 'gemini' }
          }),
          set: jest.fn().mockResolvedValue({})
        }
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1, url: 'https://youtube.com/watch?v=123' }])
      }
    };
    
    // Load script
    jest.isolateModules(() => {
      require('../popup.js');
    });
    
    // Dispatch DOMContentLoaded manually since we injected HTML after window load
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  test('Settings button toggles views', () => {
    const settingsBtn = document.getElementById('settings-btn');
    const mainView = document.getElementById('main-view');
    const setupView = document.getElementById('setup-view');
    
    // Initial state
    expect(mainView.classList.contains('hidden')).toBeFalsy();
    
    // Click settings
    settingsBtn.click();
    
    // Assert views toggled
    expect(setupView.classList.contains('hidden')).toBeFalsy();
    expect(mainView.classList.contains('hidden')).toBeTruthy();
  });
});