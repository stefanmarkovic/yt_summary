# Settings

The popup's Settings view lets a user set the OpenRouter model and API key and the sampling settings, choose the UI and output language, manage custom prompt templates that become personas, and see or reset the token and cost dashboard. Saved settings persist in `browser.storage.local` and decide whether the popup opens on Settings or on the main view.

## Sub-features

- `settings-first-run` shows Settings, not the main view, when no API key is stored.
- `settings-required` refuses to save without a key and shows the "API key and model are required." alert.
- `settings-save` persists model, key and sampling values with `provider: openrouter`, then switches to the main view.
- `settings-migration` a stored Gemini config opens Settings with `#migration-notice` visible, an empty key and model `openrouter/auto`.
- `settings-ui-language` relocalizes the popup immediately and persists `uiLanguage`.
- `settings-templates` adds or deletes a custom prompt, which appears as persona `custom_N`.
- `settings-dashboard` shows total tokens and cost, and `#reset-stats-btn` zeroes them.
- `settings-reopen` the `#settings-btn` and `#cancel-btn` navigation between views.

## How to get to it (user POV)

- Click the toolbar icon with no key stored: the popup opens directly on Settings.
- Click the toolbar icon, then **Settings** (`#settings-btn`) on the main view.

## Driving it with ytv

Preconditions:

- A fresh run (`node $Y launch`), and `node $Y doctor` exits 0.
- `llm_config` is absent (fresh profile). No YouTube tab is needed.

- **First run.** Open the popup. Run `node $Y open ext:popup.html` and `node $Y wait popup.html "!document.getElementById('setup-view').classList.contains('hidden')"`. Settings is visible, `#main-view` is hidden, `#plugin-version` reads `v<manifest version>`, `#api-model-input` is `openrouter/auto` and `#migration-notice` is hidden.
- **Save without a key.** Run `node $Y click popup.html '#save-key-btn'`. `prompts.jsonl` gains an `alert` whose message is "API key and model are required.", and Settings stays visible.
- **Model.** Run `node $Y type popup.html '#api-model-input' 'mistralai/mistral-nemo'`. Typing appends, so clear the field first with `eval`.
- **UI language.** Run `node $Y select popup.html '#ui-language' sr`. `#save-key-btn` reads `Sačuvaj`.
- **Template.** Run `node $Y type popup.html '#custom-prompt-name' 'Pirate'`, `node $Y type popup.html '#custom-prompt-text' 'Talk like a pirate.'` and `node $Y click popup.html '#add-custom-prompt-btn'`. `#custom-prompts-list` lists `Pirate`, and `#persona-level` gains an option `custom_0` whose label ends with `: Pirate`. The prefix is localized: `Prilagođeno` in sr.
- **Save.** Run `node $Y type popup.html '#api-key-input' 'ytv-fake-key'` and `node $Y click popup.html '#save-key-btn'`. `#setup-view` is hidden and `#main-view` visible.
- **Persistence.** Run `node $Y storage settings-saved`, then reload with `node $Y goto popup.html ext:popup.html`. The dump has `llm_config` = `{provider: openrouter, model: mistralai/mistral-nemo, uiLanguage: sr, apiKey: <redacted:12 chars>}` and `custom_templates[0].name` = `Pirate`. After the reload the popup opens on the main view, and `#summarize-btn` reads `Generiši sažetak`.
- **Dashboard.** Run `node $Y click popup.html '#settings-btn'`. `#dash-tokens` shows `0`, or the accumulated total after summaries. `#reset-stats-btn` sets `total_usage` to `{tokens:0,cost:0}`, which the storage dump confirms.
- **Proof.** Run `node $Y shot popup.html settings-saved` after each state change you claim, plus the `storage` dump.

## Gotchas

- Clicks and typing here are DOM events. BiDi refuses real input on extension pages, so keyboard-only flows (Tab order, Enter to submit) are not proven by this recipe.
- `#ui-language` and `#output-language` save on `change` even without pressing Save. The rest of the config is saved only by `#save-key-btn`.
- `#cancel-btn` does nothing while no key is stored. That is intended, not a bug.
- `normalizeLlmConfig` rewrites any non-OpenRouter config on popup open: the key is cleared and the model becomes `openrouter/auto`. Assert on what storage holds after a reload, not on what you typed.
- A working tree whose `llm.js` lacks `DEFAULT_MODEL` or `normalizeLlmConfig` makes the popup throw on open, so Settings never renders. `doctor` reports it.
