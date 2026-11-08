# Summarize a video

On a YouTube watch page, the user opens the popup, picks the output language, detail level and persona, and clicks **Generate summary**. The extension fetches the transcript from the page, drops SponsorBlock segments, asks the LLM for a summary, and opens a new result tab. Long transcripts are chunked, summarized per chunk, then merged.

## Sub-features

- `summarize-run` the popup "Generate summary" opens `result.html?id=<uuid>` with the summary for the active video.
- `summarize-options` `#output-language`, `#detail-level` (1/2/3) and `#persona-level` (standard, skeptic, educator, journalist, `custom_N`) reach the LLM request.
- `summarize-not-youtube` on a non-YouTube active tab the popup status shows the "not a YouTube video" error and no LLM call is made.
- `summarize-transcript-failure` when the transcript panel yields nothing, the status shows `Error: No transcript found on the YouTube page.` and `#debug-log` lists the timed `+Nms Transcript panel: ...` lines.
- `summarize-sponsorblock` filtered sponsor seconds appear in the result's sponsor card when SponsorBlock has segments.
- `summarize-long` transcripts over the chunk limit report "Splitting into N chunks" in `#status`, then make N chunk calls plus one merge.
- `summarize-cache` a second run on the same video within 6 hours logs `Transcript cache hit`.

## How to get to it (user POV)

- While a YouTube watch page (`/watch?v=`, `/shorts/`, `/live/`, `/embed/` or `youtu.be`) is the active tab, click the toolbar icon and then **Generate summary**.

## Driving it with ytv

Preconditions:

- Settings are saved through the popup (see [settings](./settings.md)), with a key in `#api-key-input`. In stub mode any non-empty key works.
- **YouTube serves a transcript to this profile.** Check before driving: run `node $Y open "https://www.youtube.com/watch?v=arj7oStGLkU"`, then `node $Y click youtube.com 'ytd-video-description-transcript-section-renderer button'`, then `node $Y wait youtube.com "document.querySelector('ytd-engagement-panel-section-list-renderer[target-id=\"PAmodern_transcript_view\"], ytd-transcript-renderer')?.innerText.trim().length > 50" --timeout 20000`. If this times out, YouTube's own transcript panel cannot load either. Report the journey as **blocked** with that command. This is the state as of 2026-11-08 for the anonymous automated profile.

- **Open video and popup.** Run `node $Y open "https://www.youtube.com/watch?v=arj7oStGLkU"` and `node $Y open ext:popup.html`. The main view shows `#summarize-btn`.
- **Choose options.** Run `node $Y select popup.html '#detail-level' 3` and `node $Y select popup.html '#persona-level' skeptic`.
- **Generate.** Run `node $Y activate youtube.com` and `node $Y dom-click popup.html '#summarize-btn'`. The result reports `"disabled": true` while the run is in flight, and `#status` moves through Fetching, then AI is thinking, then Done.
- **Result tab.** Run `node $Y wait result.html "document.querySelector('#summary .summary-body')?.textContent.includes('[ytv-stub]')" --timeout 90000`. `#video-title` is the YouTube title without ` - YouTube`, and `.tldr-card` shows `[ytv-stub] detail 3 summary.`.
- **Boundary proof.** Run `node $Y llm-log`. It lists a `summary-detail-3` request for the chosen model whose `transcriptHead` is real transcript text from the video, followed by an `entities` request from the result page.
- **Storage proof.** Run `node $Y storage summarize`. `session` holds `yt_result_<id>` with `result.detail: "3"`, a `persona` equal to the skeptic key, and a non-empty `transcript`. `local.yt_summary_result.id` is the same id, and `total_usage.tokens` > 0.
- **Not YouTube.** Run `node $Y goto youtube.com https://example.com`, `node $Y activate example.com` and `node $Y dom-click popup.html '#summarize-btn'`. `#status` shows the error, and `llm-log` gains no new request.
- **Proof.** Run `node $Y shot result.html summary` and `node $Y shot popup.html popup-done`.

## Gotchas

- The popup reads the **active** tab. Opening `ext:popup.html` makes the popup tab active, so `activate youtube.com` is required before every popup action. Otherwise the result is "not YouTube".
- Never `click` the popup after activating YouTube: extension tabs cannot be reactivated, so use `dom-click`.
- The transcript cache lives in `storage.session` for 6 hours. A second run on the same video skips YouTube. Use a fresh run to prove fetching.
- SponsorBlock has a 350 ms deadline. A slow network silently yields `sponsorSaved: 0`, which is not a failure.
- Observed 2026-11-08, Firefox 159, headless and headed, signed out:
  - The transcript panel opens as `PAmodern_transcript_view`, but it stays a spinner.

  In the user's real, signed-in Firefox the same panel path returns the transcript (1033 segments 2 s after the click in a v4.5.5 log), so this is an automation block, not an extension regression.
