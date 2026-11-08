---
name: verify-yt-summary
description: Drive the real YT Summary AI Firefox extension (popup, result tab, playlist tab, on top of a live YouTube watch page) in a throwaway Firefox via WebDriver BiDi, with the LLM stubbed at the network boundary, and capture proof. Use it to prove a change to popup/settings, summarization, the result page, chat/quiz, exports or playlist batch works the way a user sees it, beyond what `npm test` (jsdom) covers.
---

# Verify YT Summary AI

The product is a Firefox MV3 extension. No background script: `popup.html` orchestrates. It reads the **active tab** (must be a YouTube watch page), injects `transcript-fetcher.js` into the page (MAIN world), calls SponsorBlock, calls the LLM (OpenRouter), stores the result in `browser.storage.session`, and opens `result.html?id=<uuid>` in a new tab. `playlist.html?id=<job>` does batches. The surfaces are those three extension pages plus the YouTube tab.

The harness is `scripts/ytv.mjs`. It has zero dependencies and needs Node ≥ 22 and Firefox ≥ 133 (proven on Firefox 159.0.1, Windows 11). One `launch` starts a detached daemon that owns one Firefox, one throwaway profile, one BiDi session and one evidence dir. Every other command talks to that daemon.

```sh
Y=.claude/skills/verify-yt-summary/scripts/ytv.mjs     # run from the repo root
node $Y help                                           # full command list
```

## Launch

```sh
node $Y launch                    # loads the extension from the repo root (the working tree)
node $Y launch --src <dir>        # load another checkout, e.g. a `git archive HEAD` export
node $Y launch --headed           # visible window (default headless)
node $Y launch --llm live         # no LLM stub: real network calls, real key, real cost
```

Ready means `launch` printed `READY run=<id> firefox=<ver> llm=<mode>` and exited 0. By then the extension is installed as a temporary add-on at the fixed origin `moz-extension://6f2b6d3e-0c51-4b8e-9a77-3e2d1f0a9b11`, and with `--llm stub` the LLM intercept is armed. The profile starts empty, so the extension starts with no `llm_config` and the popup opens in its Settings view. The run becomes "current" (`tmp/verify-runs/current.json`). Pass `--run <id>` to address a different one.

Isolation: each run gets its own profile dir, BiDi port, control port and evidence dir, so several runs can go side by side, and none ever touches the user's own Firefox profile or windows. Never drive a run you did not launch.

## Doctor

Run this first, and again whenever anything looks off:

```sh
node $Y doctor        # exit 0 = worth driving; exit 1 prints `problems`
```

It checks four things:
- The daemon is alive and a `firefox.exe` with this run's profile is running.
- The loaded extension version equals `manifest.json` in `--src`.
- The source is consistent: `DEFAULT_MODEL` and `normalizeLlmConfig` exist. If they are missing, `popup.js` throws on open, which is what a half-reverted `llm.js` does.
- It reports whether an API key is configured, the LLM mode, and the open tabs.

To look at it, doctor opens a background `result.html?id=__ytv_probe` tab and closes it again. That probe shows only "No data to display." and makes no LLM call.

## Drive

`<target>` is a tab's context id or a URL substring. The newest match wins: `popup.html`, `result.html`, `playlist.html`, `youtube.com`. Selectors are the element ids in the HTML, which are stable and language-independent. Assert on ids and storage, not on labels: labels change with `#ui-language`.

| Command | Use |
| --- | --- |
| `open <url\|ext:page>` | New tab, waits for load. `ext:popup.html` opens the popup as a tab. |
| `activate <target>` | Make a **web** tab active. The popup's `tabs.query({active:true})` then returns it. |
| `click` / `dom-click <target> <css>` | `click` uses real pointer input on web pages. On extension pages (and always with `dom-click`) it runs `el.focus(); el.click()` without activating the tab. |
| `type <target> <css> <text> [--env NAME]` | Fills an input: real keystrokes on web pages, per-character `input` events plus `change` on extension pages. `--env` keeps secrets out of argv and the journal. |
| `select <target> <css> <value>` | Sets a `<select>` and fires `input`/`change`. |
| `text`, `eval`, `wait <target> <js> [--timeout ms]` | Read state. `wait` polls until the expression is truthy. |
| `eval chrome <js>` | Evaluates in Firefox's own browser window, not a page. Use it for toolbar state, e.g. `CustomizableUI.getPlacementOfWidget('yt-summary-ai_stefan_local-browser-action').area` is `nav-bar` when the button shows in the toolbar. |
| `shot <target> <name>`, `storage [name]`, `llm-log`, `downloads` | Evidence. |

The canonical popup recipe, the real user path minus the toolbar click:

```sh
node $Y open "https://www.youtube.com/watch?v=arj7oStGLkU"   # the video the user is watching
node $Y open ext:popup.html                                    # popup document, as a tab
# ...configure in the popup (see features/settings.md)...
node $Y activate youtube.com                                   # YouTube is the active tab again
node $Y dom-click popup.html '#summarize-btn'                  # popup now acts on the YouTube tab
node $Y wait result.html "document.querySelector('#summary .summary-body')" --timeout 90000
```

**What is not real, and why.** Firefox BiDi refuses `input.performActions` and `browsingContext.activate` on privileged `moz-extension://` pages ("does not support browsing contexts in privileged scope"). So:
- Extension-page clicks and typing are DOM events, not OS input.
- The toolbar button itself is never clicked.
- `navigator.clipboard.writeText` gets no user activation, so the Copy buttons cannot succeed here.

Everything behind the click is the production code path: the real `tabs.query`, the real `scripting.executeScript` into the live YouTube page, real SponsorBlock, real storage, and a real new tab.

**LLM stub (`--llm stub`, the default).** BiDi intercepts every request to `openrouter.ai`, reads the request body, and answers with an OpenRouter-shaped response, `usage.cost` included. The reply depends on the user message the extension sends:

| User message | Stub reply |
| --- | --- |
| `Generiši.` | Summary text `TL;DR: [ytv-stub] detail N summary…`, which quotes the first 120 chars of the transcript the extension sent |
| `Generiši JSON.` | Entities `["ytv-stub entity A","ytv-stub entity B"]` |
| `Generiši JSON kviz.` | A 2-question quiz, answers 0 and 1 |
| anything else | Chat reply `[ytv-stub] answer to: <msg>` |

Each request is logged to `llm-requests.jsonl` with its task, model, transcript length and head. Any `[ytv-stub]` text on screen is stub output by construction. Use `--llm live` with `type popup.html '#api-key-input' --env YTV_OPENROUTER_API_KEY` only when the claim is about the real provider.

## Evidence

Everything goes to `tmp/verify-runs/<runId>/` (under the repo's untracked `tmp/`, which `webExt.ignoreFiles` excludes from packaging) and survives `stop`:

- `journal.jsonl`: every command with its args and result. API keys typed with `--env`, or into an `api-key` field, are redacted.
- `console.jsonl`: console output from every page, extension pages included.
- `prompts.jsonl`: every `alert`/`confirm`, which is recorded and auto-accepted so pages never hang.
- `llm-requests.jsonl`, `NN-<name>.png`, `storage-<name>.json` (apiKey redacted), `downloads/`, `daemon.log`, `firefox.log`, `state.json`.

Proof standards:
- Drive the user path: popup controls, then the result tab. Never write `llm_config` or results into storage to skip a step.
- Capture the action and the resulting state: a `shot` before and after, plus a `storage` dump after any mutation.
- Check side effects: storage keys and values, `llm-requests.jsonl` (the right task, model and detail actually reached the boundary), and `downloads/` for exports.
- The stub is the only mock. It sits at the extension's real HTTP boundary to the LLM provider. Do not stub YouTube or SponsorBlock.
- Report each feature-map entry point you could not drive, with the command and the unmet precondition. Do not count it as verified through another path.

## Cleanup

```sh
node $Y stop          # prints {stopped, firefoxGone, profileRemoved, evidence}
```

`stop` ends the BiDi session, kills only the Firefox running with this run's unique `ytv-profile-<runId>` path, stops the daemon and deletes the profile. On Windows the spawned launcher PID hands off to a new browser PID, so the harness matches on the profile path, never on the process name. The user's own `firefox.exe` processes are never touched. The evidence dir is kept. Run `stop` after every failed attempt too. If `doctor` reports a dead daemon, `stop` still kills that run's browser by profile path. Delete old `tmp/verify-runs/<id>/` dirs by hand when they are no longer needed.

## Known blockers (Nov 2026)

- **YouTube serves no transcript to the anonymous automated profile.** In both headless and headed runs all three fetcher strategies fail:
  - M1: `timedtext` returns HTTP 200 with an empty body.
  - M2: `get_transcript` returns HTTP 400 "Precondition check failed".
  - M3: the DOM scrape finds the new `PAmodern_transcript_view` panel, which never leaves its spinner. YouTube's own "Show transcript" panel spins forever in this profile too.

  So summarize, the result page, chat/quiz and playlist cannot be proven end to end here. The popup reports `Error: All methods failed.`, and the per-strategy lines are in `#debug-log`. Check the precondition before claiming those features (see `features/summarize.md`). Never seed a fake result to get past it.
- **The working tree can be inconsistent with HEAD.** `doctor` catches the case where `popup.js` needs symbols that `llm.js` lacks. Prove the intended code with `--src` pointing at the right checkout, and say which one you used.

## Feature map

`features/README.md` indexes one recipe per user-facing feature. A proof that covers one entry point is incomplete when the map lists others. Keep the map current with `/pstack:maintain-verification-skill`.
