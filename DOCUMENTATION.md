# YT Summary AI — Tehnička Dokumentacija

## Opis

Firefox (Manifest V3) ekstenzija koja:
1. Preuzima transkript sa YouTube videa (iz page konteksta)
2. Filtrira sponzorisane segmente pomoću SponsorBlock API-ja
3. Šalje filtrirani tekst Gemini AI-u za generisanje sažetka na srpskom jeziku
4. Prikazuje sažetak u novom tabu sa chat funkcionalnostima

**Verzija:** 3.2
**Model:** `gemini-3-flash-preview`

---

## Struktura Projekta

```
yt_summary/
├── manifest.json          # MV3 manifest (permissions, host_permissions)
├── popup.html             # Popup UI: API key setup, summarize dugme, debug log
├── popup.css              # Stilovi popup-a
├── popup.js               # Orchestrator: upravlja pipelajnom
├── gemini.js              # Shared Gemini API: promptovi i request logic
├── transcript-fetcher.js  # MODUL: Dohvatanje transkripta (MAIN world)
├── transcript-parser.js   # MODUL: Parsiranje XML-a
├── sponsor-filter.js      # MODUL: SponsorBlock API i filtriranje
├── result.html            # Stranica rezultata
├── result.css             # Stilovi stranice rezultata
├── result.js              # Logika rezultata: markdown, regeneracija, chat
├── icons/
│   └── icon-48.png
└── DOCUMENTATION.md       # Ovaj fajl
```

---

## Arhitektura — Tok Podataka

```
YouTube tab                          Popup (popup.js)                     Result (result.html)
───────────                          ────────────────                     ────────────────────
                                     1. Korisnik klikne "Generiši"
                                            │
                                     2. SponsorBlock API ──► sponsor segmenti
                                            │
scripting.executeScript ◄────────── 3. Inject fetchTranscriptInPageContext()
  (world: "MAIN")                          │
       │                                   │
  Metod 1/2/3 ──────────────────► 4. Vraća XML transkript
                                            │
                                     5. Parsira XML, filtrira sponsor segmente
                                            │
                                     6. POST Gemini API ──► sažetak
                                            │
                                     7. Čuva u storage ──► otvara result.html
                                                                    │
                                                              8. Prikazuje sažetak
                                                              9. Chat / Regeneracija
```

---

## popup.js — Centralna Logika

### Tok izvršavanja (`startAnalysis`)

1. **Validacija** — provera URL-a, ekstrakcija `videoId`
2. **SponsorBlock** — poziva `getSponsorSegments(videoId)` iz `sponsor-filter.js`
3. **Transcript** — injectuje `fetchTranscriptInPageContext` iz `transcript-fetcher.js`
4. **Parsiranje** — poziva `parseXmlTranscript()` iz `transcript-parser.js`
5. **Filtriranje** — poziva `filterSegments()` iz `sponsor-filter.js`
6. **Gemini** — poziva `geminiSummarize()` iz `gemini.js`
7. **Storage + Tab** — čuva rezultat i otvara `result.html`

### fetchTranscriptInPageContext (MAIN world)

Ova funkcija se izvršava **u YouTube page kontekstu** — ima pristup cookie-jima, `ytInitialPlayerResponse`, `ytInitialData`, i `ytcfg`. Koristi tri metoda u fallback lancu:

**Metod 1: captionTracks baseUrl**
- Čita `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks`
- Prioritet jezika: `sr` → `en` (manual) → `en` (ASR) → prvi dostupan
- Fetch XML sa `baseUrl` (uklanja `&fmt=srv3` i `&fmt=json3`)
- Zahteva `credentials: 'include'` za YouTube cookie-je

**Metod 2: InnerTube /get_transcript**
- Izvlači `params` iz `ytInitialData.engagementPanels[].getTranscriptEndpoint`
- POST na `/youtubei/v1/get_transcript` sa `INNERTUBE_CONTEXT` iz `ytcfg`
- Parsira odgovor: `actions[].updateEngagementPanelAction` → `transcriptSegmentRenderer`
- Konvertuje u XML format pomoću `makeXml()`

**Metod 3: DOM Scraping** (fallback — ne zavisi od API-ja)
- 3-A: Expand opis → klik na "transcript" dugme u opisu videa
- 3-B: Tri-tačke meni → traži stavku sa tekstom "transcript/transkript/prepis"
- 3-C: Direktno otvara engagement panel sa `visibility` atributom
- Čita `ytd-transcript-segment-renderer` elemente iz DOM-a

### Pomoćne funkcije

| Funkcija | Opis |
|---|---|
| `parseXmlTranscript(xml)` | DOMParser → niz `{text, startSec, durSec}` |
| `filterSegments(segs, sponsorSegs)` | Filtrira segmente po SponsorBlock vremenima, vraća `{text, savedSeconds, categoryStats}` |
| `getSponsorSegments(videoId)` | Fetch SponsorBlock API, kategorije: sponsor, selfpromo, interaction, intro, outro |
| `geminiSummarize(key, text, level)` | POST Gemini API za sumarizaciju, parsira `usageMetadata`, računa cenu |
| `geminiChat(key, transcript, history, msg)` | POST Gemini API za chat sa `systemInstruction` kontekstom |
| `geminiRequest(key, contents, sysInstr)` | Zajednički HTTP sloj: `x-goog-api-key` header, timeout, error handling |
| `showView(view)` | Toggle između setup/main view-a |
| `log(msg)` | Piše u debug textarea i console |

---

## result.js — Prikaz Rezultata

### Inicijalizacija (`init`)
- Čita `yt_summary_result` iz `browser.storage.local`
- Čita `yt_transcript` iz `browser.storage.session`
- Poziva `updateSummaryUI()` za renderovanje sažetka

### Funkcionalnosti

**Markdown rendering** (`markdownToHtml`)
- Custom parser: headings, bold/italic, code, blockquote, lists, hr
- Ne koristi eksternu biblioteku

**Regeneracija sažetka** (`regenerateSummary`)
- Tri nivoa detaljnosti: kratko (1), srednje (2), detaljno (3)
- Ponovo poziva Gemini API sa istim transkriptom, drugačijim promptom
- Ažurira storage i UI

**Chat** (`sendChatMessage`)
- Šalje transkript kao kontekst + istoriju razgovora
- Gemini multi-turn: `contents[]` sa `role: "user"/"model"`
- Čuva `chatHistory` u memoriji (ne persistuje)

**Copy dugmad**
- "Kopiraj Markdown" — kopira raw markdown
- "Kopiraj tekst" — uklanja markdown formatiranje pre kopiranja

---

## API Referenca

### YouTube Transcript (MAIN world)

Transcript se preuzima isključivo iz MAIN world-a jer:
- Content script `fetch()` šalje `Origin: moz-extension://` header — YouTube odbija
- `wrappedJSObject.fetch()` ima isti problem
- MAIN world ima prave YouTube cookie-je i `Origin: https://www.youtube.com`

Relevantni YouTube objekti (dostupni samo u MAIN world-u):
- `window.ytInitialPlayerResponse` — sadrži `captionTracks[].baseUrl`
- `window.ytInitialData` — sadrži `engagementPanels[].getTranscriptEndpoint.params`
- `window.ytcfg.get('INNERTUBE_CONTEXT')` — kontekst za InnerTube API pozive
- `window.ytcfg.get('INNERTUBE_API_KEY')` — API ključ za InnerTube

### SponsorBlock API

```
GET https://sponsor.ajay.app/api/skipSegments
  ?videoID={id}
  &categories=["sponsor","selfpromo","interaction","intro","outro"]
```
- Radi direktno iz popup `fetch()` (nema CORS restrikcija)
- Vraća: `[{category, segment: [start, end]}]`

### Gemini API

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent
  ?key={api_key}
```
- API ključ se čuva u `browser.storage.local` pod ključem `gemini_api_key`
- Tri nivoa promptova: "Kratak rezime.", "Srednji rezime sa buletima.", "Veoma detaljan rezime."
- Odgovor: `result.candidates[0].content.parts[0].text`
- Usage: `result.usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount}`
- Cene: $0.10/1M input tokena, $0.40/1M output tokena

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
| `storage` | Čuvanje API ključa i rezultata |
| `scripting` | `executeScript(world: "MAIN")` na YouTube stranici |

---


## Debugging

- Debug log je dostupan u popup-u (dugme "Prikaži Debug")
- Loguje: verziju plugina, browser, URL, video ID, HTTP statuse, dužine odgovora
- Page-level debug linije (iz MAIN world-a) se prikazuju sa prefiksom `[PAGE]`
- Extension se reload-uje u `about:debugging#/runtime/this-firefox`
