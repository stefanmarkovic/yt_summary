# YT Summary AI — Plugin Referenca

## Opis Plugina

Firefox (Manifest V3) ekstenzija koja preuzima transkript YouTube videa, filtrira sponzorisane segmente (SponsorBlock), i šalje tekst Gemini AI-u za generisanje sažetka na srpskom jeziku.

## Struktura Projekta

```
yt_summary/
├── manifest.json       # MV3 manifest sa permissions: activeTab, storage, scripting
├── popup.html          # UI: setup (API key), main (summarize button, debug log)
├── popup.css           # Stilovi popup-a
├── popup.js            # Glavna logika (transcript fetch, SponsorBlock, Gemini AI)
├── result.html         # Stranica za prikaz sažetka (otvara se u novom tabu)
├── result.js           # Logika result stranice (markdown rendering, copy)
├── icons/
│   └── icon-48.png
└── GEMINI.md           # Ovaj fajl
```

## Trenutna Verzija: v2.5

## Arhitektura (v2.5)

### Tok podataka:
1. **popup.js** → `scripting.executeScript(world: "MAIN")` → izvršava `fetchTranscriptInPageContext()` na YouTube stranici
2. **fetchTranscriptInPageContext** (u MAIN world-u) → tri metoda u fallback lancu:
   - Metod 1: `ytInitialPlayerResponse.captionTracks[].baseUrl` → fetch XML iz page konteksta
   - Metod 2: InnerTube `/get_transcript` sa params iz `ytInitialData` (iz page konteksta, sa cookie-jima)
   - Metod 3 (DOM scraping): Expand opis → klik "Show Transcript" → čitanje iz engagement panela
3. **popup.js** → filtrira SponsorBlock segmente
4. **popup.js** → `POST generativelanguage.googleapis.com` (gemini-3-flash-preview) → Gemini sažetak
5. **popup.js** → čuva rezultat u `browser.storage.local` → otvara `result.html` u novom tabu

### popup.js — centar logike:
- SponsorBlock API (fetch iz popup konteksta)
- `scripting.executeScript` sa `fetchTranscriptInPageContext` funkcijom
- Transcript XML parsiranje (DOMParser)
- Gemini AI API poziv
- Debug log sistem

## Razvojni Workflow (Bez Git-a)

Zbog specifičnosti okruženja gde `git` nije instaliran, za sinhronizaciju sa GitHub-om koristi se direktno **GitHub API** putem `gh` (GitHub CLI) alata.

### Operacije:
- **Push fajlova:** Koristi se `gh api -X PUT /repos/:owner/:repo/contents/:path` sa base64 kodiranim sadržajem.
- **Kreiranje repo-a:** `gh repo create` radi normalno.

---

## Istorija Debug Sesije (v1.1 → v2.3)

### Problem
YouTube ne vraća transkript kad se fetch poziva iz Firefox ekstenzije.

### Pokušaj 1: Content script `fetch()` (v1.1–v1.3)
- **Metod**: Content script fetchuje `captionTracks[].baseUrl + "&fmt=json3"` direktno
- **Rezultat**: ❌ `JSON.parse: unexpected end of data` — prazan odgovor
- **Uzrok**: Content script šalje `Origin: moz-extension://...` header, YouTube odbija jer nije same-origin
- **Varijacija**: Probano sa `XMLHttpRequest` i `withCredentials: true` — isti rezultat

### Pokušaj 2: `scripting.executeScript(world: "MAIN")` sa timedtext URL (v1.5)
- **Metod**: Injectujem fetch() u YouTube page context (world:MAIN), fetchujem timedtext URL
- **Rezultat**: ❌ HTTP 200, `Content-Type: text/html; charset=UTF-8`, body: **0 bajtova**
- **Uzrok**: Čak i iz page contexta, timedtext URL vraća prazan HTML odgovor. Potvrđeno sa arrayBuffer (genuino 0 bajtova).

### Pokušaj 3: `wrappedJSObject.fetch()` (v1.8–v1.9)
- **Metod**: Firefox-specifičan API — content script poziva page-ov fetch preko `window.wrappedJSObject.fetch()`
- **Rezultat**: ❌ Identičan: HTTP 200, text/html, 0 bajtova
- **Dijagnostika** (v1.9): Probano 3 metode u jednom pozivu:
  1. `wrappedJSObject.fetch().text()` → 0 bajtova
  2. `wrappedJSObject.fetch().arrayBuffer()` → 0 bajtova
  3. `XMLHttpRequest` iz content scripta → 0 bajtova
- **Zaključak**: timedtext baseUrl jednostavno ne radi ni iz jednog konteksta (moguće YouTube promena ili regionalna restrikcija za Srbiju/EU)

### Pokušaj 4: InnerTube `/get_transcript` sa ručnim protobuf (v1.6–v1.7)
- **Metod**: POST na `/youtubei/v1/get_transcript` sa ručno kodiranim protobuf params
- **v1.6** (flat protobuf): ❌ HTTP 400 FAILED_PRECONDITION
- **v1.7** (nested protobuf — `outer{field1: inner{field1: videoId}}`): ❌ HTTP 400 FAILED_PRECONDITION
- **Uzrok**: Protobuf format je netačan ili endpoint zahteva dodatnu autentifikaciju

### Pokušaj 5: InnerTube `/get_transcript` sa params iz `ytInitialData` (v2.0)
- **Metod**: Izvlačim gotov `params` iz `ytInitialData.engagementPanels[].getTranscriptEndpoint.params`
- **Plus**: Generiram SAPISIDHASH iz SAPISID kolačića (SHA-1 hash)
- **Plus**: Šaljem Authorization, X-Goog-AuthUser, X-Origin headere
- **Rezultat**: ❌ HTTP 400 FAILED_PRECONDITION
- **Dijagnostika**:
  - `hasYtInitialData: true`, `foundTranscriptPanel: true`, `hasParams: true`
  - `hasSAPISID: true`, `authGenerated: true`
  - Panel identifier: `engagement-panel-searchable-transcript`
  - Params preview: `CgtsWHNfbXNxT2RFTRIOQ2dBU0FtVn...`

### Pokušaj 6: Kompletni `INNERTUBE_CONTEXT` iz `ytcfg` (v2.1)
- **Metod**: Umesto ručnog `{ client: {...} }`, koristim `ytcfg.get('INNERTUBE_CONTEXT')` sa svim poljima
- **Rezultat**: ❌ HTTP 400 FAILED_PRECONDITION
- **Dijagnostika**: `bodyContextKeys: client, user, request, clickTracking` — svi ključevi prisutni
- **Zaključak**: `get_transcript` endpoint možda zahteva nešto što ne možemo reproducirati iz extension konteksta, ili je endpoint promenio format

### Pokušaj 7: ANDROID klijent + direktan baseUrl fetch (v2.2)
- **Metod**: Po uzoru na `youtube-transcript-api` (Python biblioteka):
  1. POST `/youtubei/v1/player` sa `clientName: "ANDROID"`, `clientVersion: "20.10.38"`
  2. Dobijam svež `captionTracks[].baseUrl`
  3. GET na baseUrl (XML format, bez `&fmt=json3`)
  4. Parsiram XML sa DOMParser
- **Rezultat**: ❌ HTTP 403 ("Sorry..." bot detection page)
- **Uzrok**: Browser extension popup `fetch()` šalje `Origin: moz-extension://...` i `Sec-Fetch-*` headere. YouTube bot detekcija prepoznaje da ANDROID klijent dolazi iz browsera (ne sa Android uređaja) i blokira request sa 403.
- **Zaključak**: ANDROID klijent pristup radi samo iz server-side konteksta (Python), ne iz browser extension-a.

### Pokušaj 8: MAIN world execution sa fallback lancem (v2.3) ← TRENUTNI
- **Metod**: `scripting.executeScript(world: "MAIN")` — ceo transcript fetch se izvršava u YouTube page kontekstu:
  1. Metod 1: `ytInitialPlayerResponse.captionTracks[].baseUrl` → fetch XML iz page konteksta (sa cookie-jima i pravim Origin-om)
  2. Metod 2: InnerTube `/player` sa WEB klijentom + `ytcfg` context iz page-a → svež baseUrl → fetch
  3. Metod 2b: Probaj `&fmt=json3` format ako XML vrati 0 bajtova → konvertuj u XML
  4. Metod 3 (fallback): DOM scraping — programski klik na "Show Transcript" → čitanje iz panela
- **Status**: 🔄 Čeka testiranje
- **Zašto bi trebalo da radi**: Iz MAIN world-a, fetch ima prave YouTube cookie-je i `Origin: https://www.youtube.com`. DOM scraping je krajnji fallback koji ne zavisi od API-ja.

---

## Ključna Saznanja

### YouTube timedtext API
- `captionTracks[].baseUrl` iz `ytInitialPlayerResponse` — URL za preuzimanje transkripta
- Ovaj URL **ne radi** kad se poziva iz Firefox extension konteksta (vraća prazan HTML)
- Razlog: verovatno CONSENT cookie flow ili regionalna restrikcija
- Ref. biblioteka (`youtube-transcript-api`) uklanja `&fmt=srv3` iz URL-a

### YouTube InnerTube API
- `/youtubei/v1/player` — vraća player data (uključujući captionTracks)
- `/youtubei/v1/get_transcript` — trebalo bi da vraća transkript, ali daje FAILED_PRECONDITION
- ANDROID klijent (`clientName: "ANDROID"`) ima manje restrikcija od WEB klijenta
- `INNERTUBE_API_KEY`: tipično `AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`
- `INNERTUBE_CONTEXT`: dostupan preko `window.ytcfg.get('INNERTUBE_CONTEXT')`

### Firefox Extension specifičnosti
- `scripting.executeScript(world: "MAIN")` — pokreće kod u page JS kontekstu
- `wrappedJSObject` — Firefox-specifičan, daje pristup page objektima iz content scripta
- Xray wrappers — konvertuj stringove sa `+ ''` za cross-compartment transfer
- Content script `fetch()` šalje `Origin: moz-extension://` — YouTube to odbija
- `cloneInto()` / `exportFunction()` — Firefox helpers za cross-compartment komunikaciju

### SAPISIDHASH autentifikacija
```javascript
const timestamp = Math.floor(Date.now() / 1000);
const input = `${timestamp} ${sapisid} https://www.youtube.com`;
const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
const header = `SAPISIDHASH ${timestamp}_${hexEncode(hash)}`;
```
- SAPISID kolačić dostupan iz `document.cookie` u page kontekstu
- Potreban za neke InnerTube endpoint-ove (ali ne za `/player` sa ANDROID klijentom)

### SponsorBlock API
- `https://sponsor.ajay.app/api/skipSegments?videoID={id}&categories=[...]`
- Radi direktno iz popup fetch-a (nema CORS problema)
- Kategorije: sponsor, selfpromo, interaction, intro, outro

### Gemini API
- `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={key}`
- API ključ čuva se u `browser.storage.local`
- Tri nivoa detaljnosti: kratak, srednji, detaljan

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

## Debugging
- Debug log dostupan u popup-u (dugme "Prikaži Debug")
- Svaki korak loguje: verziju, browser info, URL, video ID, HTTP statuse, Content-Type, dužinu odgovora
- Extension se reload-uje u `about:debugging#/runtime/this-firefox`

## Preporuke za Dalje
1. Ako v2.3 (MAIN world + DOM scraping) ne radi, razmotriti lokalni Python backend (`youtube-transcript-api`)
2. Pratiti GitHub issue-ove na `jdepoix/youtube-transcript-api` za najnovije promene
3. Alternativa: Native messaging host (Python proces koji extension poziva za transcript fetch)
4. Alternativa: Koristiti YouTube Data API v3 sa captions.download (zahteva OAuth2)
