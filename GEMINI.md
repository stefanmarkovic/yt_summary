# YT Summary AI - Development Mandates

## Core Directives for AI Agents
When working on this repository, you **MUST** adhere to the following mandates. Failure to do so violates the project's integrity.

1. **Test Driven Verification:** 
   - Before finalizing any feature, bug fix, or UI change, you MUST run `npm test`.
   - If `npm test` fails, you MUST fix the errors before concluding the task.

2. **Translation Coverage (i18n):**
   - Whenever you add a new UI element to `popup.html`, `result.html`, or `playlist.html`, you MUST add a `data-i18n` attribute.
   - You MUST add the corresponding translation key to `i18n.js` for ALL supported languages (English, Serbian, German, Spanish).
   - The integration test will fail if a key is missing.

3. **No Uncaught Syntax Errors:**
   - The project uses ESLint. `npm test` will run ESLint before Jest. Do not leave trailing characters or invalid syntax in `.js` files.

4. **Context Window:**
   - This project uses Manifest V3. Background scripts are not used; the popup maintains its own state and acts as the orchestrator.

## Testing Architecture
- **Unit Tests:** `jest` is used for logic tests (e.g., parsing, i18n functions).
- **DOM Tests:** `jest-environment-jsdom` is used to load HTML and simulate browser interactions.
- **Coverage:** We test translation completeness by parsing HTML files and asserting keys exist in `I18N`.