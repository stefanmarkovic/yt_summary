# YT Summary AI

Firefox (Manifest V3) ekstenzija koja generiše AI sažetke YouTube videa na srpskom jeziku. Preuzima transkript, filtrira sponzorisane segmente (SponsorBlock), i koristi Gemini AI za sumarizaciju.

## Funkcionalnosti

- **AI Sumarizacija:** Koristi Google Gemini (`gemini-3-flash-preview`) za sažimanje transkripata.
- **SponsorBlock:** Automatski uklanja sponzore, samopromotivne segmente, intro/outro i interakcije pre sumarizacije.
- **Tri nivoa detaljnosti:** Kratko, srednje, ili detaljno — bira se pre i posle generisanja.
- **Chat sa AI-jem:** Postavljanje pitanja o videu direktno na stranici rezultata.
- **Robustan transcript fetch:** Fallback lanac (captionTracks → InnerTube → DOM scraping) u YouTube page kontekstu.

## Arhitektura

1. **Transcript** — `scripting.executeScript(world: "MAIN")` izvršava fetch u YouTube page kontekstu (3 metoda u fallback lancu).
2. **Filtriranje** — SponsorBlock API uklanja sponzorisane segmente iz transkripta.
3. **AI** — Filtrirani tekst se šalje Gemini API-ju (`gemini-3-flash-preview`).
4. **Prikaz** — Sažetak se prikazuje u novom tabu sa markdown renderingom, chat-om, i copy opcijama.

## Struktura projekta

- `manifest.json` — MV3 konfiguracija ekstenzije
- `popup.html/css/js` — Popup interfejs i centralna logika
- `result.html/js` — Stranica za prikaz rezultata (sažetak, chat, regeneracija)
- `DOCUMENTATION.md` — Detaljna tehnička dokumentacija

## Instalacija

1. Klonirajte repozitorijum.
2. Otvorite Firefox → `about:debugging#/runtime/this-firefox`.
3. Kliknite "Load Temporary Add-on".
4. Izaberite `manifest.json` iz direktorijuma projekta.

## Konfiguracija

1. Nabavite Gemini API ključ na [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Unesite ključ u popup podešavanjima ekstenzije.
