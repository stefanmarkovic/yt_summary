# YT Summary AI — Tehnička Dokumentacija

## Opis

Firefox (Manifest V3) ekstenzija koja:
1. Preuzima transkript sa YouTube videa (iz page konteksta)
2. Filtrira sponzorisane segmente pomoću SponsorBlock API-ja
3. Šalje filtrirani tekst LLM-u (Gemini, DeepSeek, Ollama) za generisanje sažetka na srpskom jeziku
4. Prikazuje sažetak u novom tabu sa chat funkcionalnostima

**Verzija:** 4.3
**Podrazumevani model:** `gemini-3-flash-preview`

---

## Struktura Projekta

```
yt_summary/
├── manifest.json            # MV3 manifest (permissions, host_permissions)
├── popup.html               # Popup UI: API key setup, summarize dugme, debug log
├── popup.css                # Stilovi popup-a
├── popup.js                 # Thin orchestrator: startAnalysis pipeline
├── prompts.js               # Prompt construction: DETAIL/PERSONA_PROMPTS, resolvePersona, buildSystemInstruction
├── gemini.js                # LLM transport: provider adapters, retry, usage tracking
├── transcript-fetcher.js    # MAIN world: dohvatanje transkripta (3 strategije)
├── transcript-pipeline.js   # Konsolidovani pipeline: fetch + SponsorBlock + filtriranje
├── markdown-renderer.js     # Pure function: markdownToHtml + setSafeHTML
├── summary-renderer.js      # Reusable summary card rendering (TL;DR, entities, SponsorBlock, usage)
├── chat.js                  # Chat modul: owns chatHistory internally
├── quiz.js                  # Quiz modul: generisanje, renderovanje, provera
├── result.html              # Stranica rezultata
├── result.css               # Stilovi stranice rezultata
├── result.js                # Orchestrator rezultata: UI lifecycle, regeneracija, entity extraction
├── icons/
│   └── icon-48.png
└── DOCUMENTATION.md         # Ovaj fajl
```

---

## Arhitektura — Tok Podataka

```
YouTube tab                          Popup (popup.js)                     Result (result.html)
───────────                          ────────────────                     ────────────────────
                                     1. Korisnik klikne "Generiši"
                                            │
                                     2. getProcessedTranscript(tabId, videoId)
                                            │
                                     ┌──────┴──────┐
                                     │  pipeline   │
scripting.executeScript ◄──────── Inject fetchTranscriptInPageContext()
  (world: "MAIN")                    │             │
       │                             │  SponsorBlock API (paralelno)
  Strategija 1/2/3 ────────► segments[]            │
                                     │  Filtriranje + formatiranje
                                     └──────┬──────┘
                                            │
                                     3. llmSummarize() → sažetak
                                            │
                                     4. Čuva u storage → otvara result.html
                                                                    │
                                                              5. Prikazuje sažetak
                                                              6. Entity extraction (pozadina)
                                                              7. Chat / Quiz / Regeneracija
```

---

## Moduli

### transcript-fetcher.js (MAIN world)

Funkcija `fetchTranscriptInPageContext(videoId)` se izvršava **u YouTube page kontekstu** — ima pristup cookie-jima, `ytInitialPlayerResponse`, `ytInitialData`, i `ytcfg`.

Vraća: `{status, segments: [{text, startSec, durSec}], debugLines}`

Interni seam-ovi (fallback lanac):

| Strategija | Opis |
|---|---|
| `tryBaseUrl()` | Čita `captionTracks[].baseUrl`, fetch XML, parsira u MAIN world-u |
| `tryInnerTube()` | POST `/youtubei/v1/get_transcript`, parsira `transcriptSegmentRenderer` |
| `tryDomScraping()` | A: opis dugme, B: tri-tačke meni, C: engagement panel |

### transcript-pipeline.js

Konsolidovani duboki modul koji orkestrira celokupan pipeline:

```
getProcessedTranscript(tabId, videoId)
  → {text, savedSeconds, categoryStats, debugLines, segmentCount, sponsorCount}
```

Apsorbuje logiku bivših `transcript-parser.js` i `sponsor-filter.js`. XML round-trip je eliminisan — fetcher vraća segments[] direktno.

### prompts.js

Pure functions za konstrukciju prompta. Bez I/O zavisnosti.

| Funkcija | Opis |
|---|---|
| `buildSystemInstruction(transcript, taskSpec)` | Gradi system prompt sa transkriptom, poglavljima, instrukcijom, personom i jezikom |
| `resolvePersona(personaValue, customPrompts)` | Razrešava persona vrednost: standardne ključeve prosleđuje dalje, `custom_N` konvertuje u tekst šablona |

Konstante: `DETAIL_PROMPTS`, `PERSONA_PROMPTS`.

### gemini.js

LLM transport modul sa internim provider seam-ovima:

| Funkcija | Opis |
|---|---|
| `llmTask(config, transcript, taskSpec)` | Centralni task handler: trimming, request, usage tracking, JSON cleanup |
| `llmSummarize(config, transcript, level, persona)` | Sumarizacija transkripta |
| `llmSummarizeLong(config, transcript, ...)` | Map-reduce sumarizacija za duge transkripte |
| `llmExtractEntities(config, transcript)` | Ekstrakcija entiteta (JSON) |
| `llmQuiz(config, transcript)` | Generisanje kviza (JSON) |
| `llmChat(config, transcript, history, msg)` | Chat sa kontekstom transkripta |

Interni provider seam-ovi: `buildGeminiRequest`, `buildOpenAIRequest`, `parseGeminiResponse`, `parseOpenAIResponse`.

### summary-renderer.js

Reusable modul za renderovanje summary kartica. Koristi se u `result.js` i `playlist.js`.

| Funkcija | Opis |
|---|---|
| `renderSummaryCard(container, result, config)` | Renderuje kompletnu summary karticu: TL;DR, summary body, entiteti, SponsorBlock, usage |
| `formatDuration(seconds)` | Formatira sekunde u `Xm Ys` format |

Konstante: `CATEGORY_LABELS`.

### markdown-renderer.js

Pure functions bez zavisnosti:

| Funkcija | Opis |
|---|---|
| `markdownToHtml(md)` | Custom markdown parser: headings, bold/italic, code, lists, timestamps |
| `setSafeHTML(element, html)` | Bezbedan DOM injection putem DOMParser |

### chat.js

`initChat(config, transcript, messagesEl, inputEl, sendBtnEl)` — Chat modul koji interno drži `chatHistory`. Ne leakuje stanje kao global.

### quiz.js

`handleGenerateQuiz(config, transcript, messagesEl, buttonEl)` — Generisanje kviza, DOM renderovanje, provera odgovora. Potpuno self-contained.

### result.js

Thin orchestrator za stranicu rezultata:
- `updateSummaryUI(result)` — renderuje sažetak, entitete, SponsorBlock info, usage
- `regenerateSummary(level)` — ponovna sumarizacija sa drugačijim nivoom detaljnosti
- `handleDownloadTranscript()` — preuzimanje transkripta kao .txt fajl
- Entity extraction — pokreće se pri init-u ako entiteti nisu prisutni

### popup.js

Thin orchestrator za popup:
- Konfiguracija LLM provajdera
- `startAnalysis()` — poziva `getProcessedTranscript()` i `llmSummarize()`
- Nadzorna tabla (potrošnja tokena)

---

## API Referenca

### YouTube Transcript (MAIN world)

Transcript se preuzima isključivo iz MAIN world-a jer:
- Content script `fetch()` šalje `Origin: moz-extension://` header — YouTube odbija
- MAIN world ima prave YouTube cookie-je i `Origin: https://www.youtube.com`

### SponsorBlock API

```
GET https://sponsor.ajay.app/api/skipSegments
  ?videoID={id}
  &categories=["sponsor","selfpromo","interaction","intro","outro"]
```

### LLM API

Podržani provajderi:
- **Gemini** — Google AI Studio format (`x-goog-api-key` header)
- **DeepSeek / Ollama / Custom** — OpenAI-compatible format (`Authorization: Bearer` header)

---

## Manifest Permisije

```json
{
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": [
    "https://*.youtube.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://sponsor.ajay.app/*"
  ]
}
```

| Permisija | Razlog |
|---|---|
| `activeTab` | Pristup URL-u i tab ID-u aktivnog taba |
| `storage` | Čuvanje konfiguracije i rezultata |
| `scripting` | `executeScript(world: "MAIN")` na YouTube stranici |

---

## Debugging

- Debug log je dostupan u popup-u (dugme "Prikaži Debug")
- Loguje: verziju plugina, browser, URL, video ID, HTTP statuse, dužine odgovora
- Page-level debug linije (iz MAIN world-a) se prikazuju sa prefiksom `[PAGE]`
- Extension se reload-uje u `about:debugging#/runtime/this-firefox`
