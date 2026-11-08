# Playlist batch

When the active YouTube URL carries a `list=` parameter, the popup shows **Summarize Playlist**. It collects the playlist's video ids from the page, stores a batch job, and opens `playlist.html?id=<job>`. That page fetches each video's transcript directly, summarizes them one by one with a progress bar, and renders one summary card per video.

## Sub-features

- `playlist-button` `#playlist-summarize-btn` is visible only when the active tab is YouTube with `list=`.
- `playlist-collect` ids come from `ytInitialData` (the `/playlist` page or the watch-page side panel), then DOM links, then the current `v`.
- `playlist-run` `playlist.html` updates `#progress-text` and `#batch-progress`, and appends a card per video to `#batch-results`.
- `playlist-missing` `playlist.html` without a valid job shows "No batch job found."
- `playlist-empty` no ids found shows the "playlist empty" alert.

## How to get to it (user POV)

- On `youtube.com/watch?v=…&list=…` or `youtube.com/playlist?list=…`, click the toolbar icon, then **Summarize Playlist**.

## Driving it with ytv

Preconditions:

- Settings are saved with a key through the popup (see [settings](./settings.md)).
- The YouTube transcript precondition from [summarize](./summarize.md) holds, since the batch fetches transcripts too.
- A public playlist URL (pick a short one). Record the URL you used in the report.

- **Open.** Run `node $Y open "<watch URL with &list=>"`, `node $Y open ext:popup.html` and `node $Y activate youtube.com`.
- **Button visibility (not provable here).** `node $Y eval popup.html "document.getElementById('playlist-summarize-btn').classList.contains('hidden')"` returns `true`, because the popup tab was the active tab when it loaded. See Gotchas. Report `playlist-button` as unverified.
- **Start the batch.** With YouTube active, run `node $Y dom-click popup.html '#playlist-summarize-btn'`. The popup tab closes (`window.close()`), and a `playlist.html?id=` tab opens.
- **Progress.** Run `node $Y wait playlist.html "document.querySelectorAll('#batch-results > *').length > 0" --timeout 180000`. `#progress-text` advances, and `llm-log` shows one summary task per video.
- **Missing job.** Run `node $Y open "ext:playlist.html?id=nope"` and `node $Y text playlist.html '#progress-text'`. It reads "No batch job found.".
- **Proof.** Run `node $Y shot playlist.html playlist` and `node $Y storage playlist`. The dump has `session.yt_batch_<job>.videoIds`.

## Gotchas

- `#playlist-summarize-btn` visibility is computed once, when the popup document loads, from the tab that is active **at that moment**. `open ext:popup.html` makes the popup tab active, so the button stays hidden. Clicking it with `dom-click` still runs the handler against the then-active YouTube tab. The visibility sub-feature cannot be proven with the popup-as-tab model. Report it as unverified.
- The batch tab does its own `fetch` of the watch page with `credentials: 'include'`, separate from the popup's MAIN-world fetcher. A fix in `transcript-fetcher.js` does not cover it.
- Not driven yet. This recipe is derived from `popup.js` and `playlist.js`. The first run that executes it must correct any step that differs.
