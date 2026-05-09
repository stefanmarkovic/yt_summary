# YT Summary AI

A Firefox (Manifest V3) extension that generates AI summaries of YouTube videos in Serbian. It fetches transcripts, filters out sponsored segments using SponsorBlock, and uses Gemini AI to produce the summary.

## Features

- **Automated Summarization:** Uses Google's Gemini AI to summarize YouTube video transcripts.
- **SponsorBlock Integration:** Automatically removes sponsored segments, self-promotions, and other non-content parts before summarization.
- **Serbian Language Support:** Designed specifically to provide summaries in Serbian.
- **Robust Transcript Fetching:** Implements a fallback chain for fetching transcripts, including direct page context access and DOM scraping.
- **Clean UI:** Simple popup interface for configuration and triggering summaries.

## Architecture

The extension operates by executing scripts in the YouTube page context to bypass standard extension limitations when fetching transcripts.

1. **Transcript Extraction:** Attempts multiple methods in order:
   - Direct fetch from `captionTracks` in page context.
   - InnerTube API calls.
   - DOM scraping (fallback).
2. **Filtering:** Queries SponsorBlock API to identify and remove irrelevant segments.
3. **AI Processing:** Sends the filtered text to Gemini AI (gemini-1.5-flash) via API.
4. **Display:** Renders the resulting markdown in a new tab.

## Project Structure

- `manifest.json`: Extension configuration (MV3).
- `popup.html/css/js`: Main extension interface and core logic.
- `result.html/js`: Summary display page.
- `icons/`: Extension icons.

## Installation

1. Clone this repository.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click "Load Temporary Add-on".
4. Select `manifest.json` from the project directory.

## Configuration

- Obtain a Gemini API key from Google AI Studio.
- Enter the API key in the extension popup settings.

## License

MIT (or check local conventions)
