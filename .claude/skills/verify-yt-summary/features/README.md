# YT Summary AI verification map

This directory is the maintained source for verifying what a user of the YT Summary AI Firefox extension can see and do. Read this index, then use the matching feature file as the recipe. All commands assume `Y=.claude/skills/verify-yt-summary/scripts/ytv.mjs`, run from the repo root.

## Baseline preconditions

- A run started with `node $Y launch [--src <checkout>]` printed `READY`, and `node $Y doctor` exits 0.
- The profile is fresh: no `llm_config`, so the popup opens in Settings. The default is `--llm stub`.
- Recipes that need a summary also need YouTube to serve a transcript to this profile. Check that first (see [summarize](./summarize.md)). As of Nov 2026 it does not, so those recipes report blocked.
- Reference video: `https://www.youtube.com/watch?v=arj7oStGLkU` (TED, manual captions, chapters). Playlist URLs need `&list=`.

## Driving conventions

- Start from the baseline unless a recipe says otherwise. Configure the extension through the popup's Settings, never through storage.
- Use element ids (`#summarize-btn`, `#api-key-input`) as handles. Labels are localized by `#ui-language`.
- Extension tabs cannot be activated or given real input (Firefox BiDi privileged scope). Use `click` or `dom-click` on them, and `activate` only on the YouTube tab.
- The popup acts on whichever tab is **active**: `activate youtube.com` before clicking a popup action.
- `alert()` calls are auto-accepted and logged in `prompts.jsonl`. Assert on that file, not on a dialog.

## Proof and skip reporting

- UI proof is a `shot` of the page plus an `eval`/`text` of the asserted element, both recorded in `journal.jsonl`.
- Mutation proof is a `storage <name>` dump after the action, plus a reload (`goto ... ext:popup.html`) showing the value survived.
- LLM proof is `llm-log`: the expected `task`, `model` and `transcriptHead` reached the boundary.
- Name the feature id and entry point with every artifact you cite.
- Report an unreachable path with the attempted command and the unmet precondition. Never report it as verified through a different path.

## Feature entry contract

Each file has an H1, a one-paragraph description, then exactly: `Sub-features`, `How to get to it (user POV)`, `Driving it with ytv`, `Gotchas`.

## Features

- [Settings](./settings.md): provider and model, API key, UI and output language, custom prompt templates, usage dashboard. **Proven on 2026-11-08.**
- [Summarize a video](./summarize.md): popup "Generate summary" on a YouTube tab, leading to the result tab. Blocked by the YouTube transcript precondition.
- [Result page](./result-page.md): detail regeneration, entities, word cloud, exports, transcript download, copy.
- [Chat and quiz](./chat-quiz.md): asking questions and the multiple-choice quiz on the result page.
- [Playlist batch](./playlist.md): "Summarize Playlist" on a `list=` URL, leading to `playlist.html`.
