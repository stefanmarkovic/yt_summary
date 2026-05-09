# YT Summary AI — Plugin Referenca (v3.0)

Firefox (Manifest V3) ekstenzija koja preuzima transkript YouTube videa, filtrira sponzorisane segmente (SponsorBlock), i šalje tekst Gemini AI-u za generisanje sažetka na srpskom jeziku.

## Ključne Mogućnosti

- **Automatsko Sažimanje:** Koristi Google Gemini AI (`gemini-1.5-flash-preview`) za analizu transkripta.
- **SponsorBlock Integracija:** Automatski uklanja sponzore, samopromociju, intro/outro delove pre slanja AI-u.
- **Podrška za Srpski Jezik:** Promptovi i izlaz su optimizovani za srpski jezik.
- **Napredno Preuzimanje Transkripta:** Implementiran "fallback" lanac od 3 metode (Page Context Fetch, InnerTube API, DOM Scraping).
- **Moderan UI:** Pregledan popup sa podešavanjima, debug logom i vizuelnim indikatorima progresa.

## Arhitektura (v3.0)

Ekstenzija koristi `scripting.executeScript` u `MAIN` world-u kako bi pristupila YouTube page kontekstu i zaobišla CORS restrikcije:

1. **Ekstrakcija:** Pokušava preuzimanje preko `captionTracks`, zatim preko InnerTube `/player` endpoint-a, i na kraju putem DOM scrapovanja.
2. **Filtriranje:** Poziva SponsorBlock API i precizno uklanja nebitne segmente iz teksta.
3. **AI Obrada:** Šalje pročišćen tekst Gemini API-u.
4. **Prikaz:** Rezultat se renderuje kao Markdown u novom tabu sa opcijama za kopiranje i ponovno pokretanje.

## Struktura Projekta

- `manifest.json`: Konfiguracija ekstenzije (MV3).
- `popup.html/css/js`: Glavni interfejs i logika preuzimanja/filtriranja.
- `result.html/js`: Stranica za prikaz sažetka (Markdown rendering).
- `GEMINI.md`: Detaljna tehnička dokumentacija i istorija debug sesija.
- `icons/`: Ikonice ekstenzije.

## Instalacija

1. Preuzmi (ili kloniraj) ovaj repozitorijum.
2. Otvori Firefox i idi na `about:debugging#/runtime/this-firefox`.
3. Klikni na "Load Temporary Add-on".
4. Izaberi `manifest.json` iz foldera projekta.

## Konfiguracija

- Potreban je Gemini API ključ koji se može besplatno generisati na [Google AI Studio](https://aistudio.google.com/).
- Unesi ključ u podešavanja ekstenzije (zupčanik u popup-u).

## Licenca

MIT
