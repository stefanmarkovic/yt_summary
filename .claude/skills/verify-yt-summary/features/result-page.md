# Result page

`result.html?id=<uuid>` shows the summary of one analysis: title, date, reading stats, TL;DR card, rendered Markdown with clickable `[MM:SS]` timestamps, keyword cloud, extracted entities, SponsorBlock savings, token usage, and the popup's debug log. From it the user can regenerate at another detail level, copy the summary, export it to HTML, Markdown ("Notion") or PDF, and download the transcript.

## Sub-features

- `result-render` shows the title, `#meta-date`, `#meta-words`, `.tldr-card`, `.summary-body`, `.usage-card` and `#word-cloud-container`.
- `result-entities` runs entity extraction on load and adds `.entity-card`.
- `result-regenerate` `#detail-short`, `#detail-medium` and `#detail-detailed` re-summarize, move `.active`, and persist to `yt_result_<id>`.
- `result-export` `#export-html-btn` downloads `summary-<videoId>.html`, `#export-notion-btn` downloads `summary-<videoId>.md`, and `#export-pdf-btn` calls `window.print()`.
- `result-transcript` `#download-transcript-btn` downloads `transcript-<videoId>.txt`.
- `result-copy` `#copy-md-btn` and `#copy-text-btn` write to the clipboard and show "Copied!".
- `result-timestamp` clicking `.timestamp-link` opens the video at `&t=<s>s` in a new tab.
- `result-missing` `result.html` with an unknown id shows "No data to display."

## How to get to it (user POV)

- It opens automatically after **Generate summary** in the popup (see [summarize](./summarize.md)).

## Driving it with ytv

Preconditions:

- A result tab produced by the [summarize](./summarize.md) journey in this run. That journey has its own YouTube transcript precondition. Do not open `result.html` against hand-written storage.

- **Render.** Run `node $Y eval result.html "({ title: document.getElementById('video-title').textContent, tldr: document.querySelector('.tldr-card p')?.textContent, words: document.getElementById('meta-words').textContent, cloud: getComputedStyle(document.getElementById('word-cloud-container')).display })"`. The title matches the video, the TL;DR is the stub's, and the cloud displays as `block`.
- **Entities.** Run `node $Y wait result.html "document.querySelector('.entity-card')?.textContent.includes('ytv-stub entity A')"`. `llm-log` shows an `entities` task.
- **Regenerate.** Run `node $Y click result.html '#detail-short'` and `node $Y wait result.html "document.querySelector('#detail-short').classList.contains('active') && document.querySelector('.tldr-card p').textContent.includes('detail 1')" --timeout 60000`. `llm-log` gains `summary-detail-1`. `node $Y storage regenerated` shows `yt_result_<id>.result.detail = "1"`.
- **Exports.** Run `node $Y click result.html '#export-html-btn'`, `node $Y click result.html '#export-notion-btn'` and `node $Y click result.html '#download-transcript-btn'`, then `node $Y downloads`. `summary-<videoId>.html`, `summary-<videoId>.md` and `transcript-<videoId>.txt` exist with non-zero size, and the `.md` starts with `# <title>`.
- **Missing result.** Run `node $Y open "ext:result.html?id=does-not-exist"` and `node $Y text result.html '#loading'`. It reads "No data to display." (localized).
- **Proof.** Run `node $Y shot result.html result-after-regenerate` and keep `downloads/`.

## Gotchas

- Copy buttons cannot be proven here. Extension-page clicks are DOM clicks without user activation, so `navigator.clipboard.writeText` rejects and an alert lands in `prompts.jsonl`. That is a harness limit, not an app bug. Prove copy in a headed manual check.
- `#export-pdf-btn` calls `window.print()`. The profile sets `print.always_print_silent`, so nothing visible happens. Do not claim the PDF output.
- `result.html` with no `id` falls back to the legacy `yt_summary_result`, but it has no transcript. Regenerate, quiz and transcript download are disabled there by design.
- Timestamp links open a real YouTube tab, which changes the newest `youtube.com` match for later commands.
