# YT Summary AI

Firefox (Manifest V3) ekstenzija koja generiše AI sažetke YouTube videa na srpskom jeziku. Preuzima transkript, filtrira sponzorisane segmente (SponsorBlock), i koristi Gemini AI za sumarizaciju.

## Funkcionalnosti

- **AI Sumarizacija:** Koristi Google Gemini API za generisanje kvalitetnih sažetaka transkripata.
- **SponsorBlock Integracija:** Automatski prepoznaje i uklanja sponzorske poruke, samopromociju, intro/outro i interakcije pre nego što se tekst pošalje AI-u (štedi tokene i poboljšava kvalitet).
- **Fleksibilan nivo detaljnosti:** Izaberite između kratkog, srednjeg i veoma detaljnog rezimea pre i posle generisanja.
- **Chat sa AI-jem:** Prijatno sučelje koje omogućava korisniku da postavlja pitanja o videu.
- **Robusno dohvatanje transkripta:** Kompleksan fallback lanac za prevazilaženje restrikcija (koristi direktan YouTube context, InnerTube API, i po potrebi DOM scraping).
- **Bezbednost:** Ugrađena sanitizacija Markdown renderovanja radi zaštite od XSS-a.

## Arhitektura

1. **Transcript:** Kroz `scripting.executeScript(world: "MAIN")` ekstenzija pokreće logiku u izolovanom *page context*-u (glavnom YouTube prozoru) omogućavajući premošćavanje mnogih zaštita.
2. **Filtriranje:** Korišćenjem javnog SponsorBlock API-ja transkript se reže tačno na mestima gde se pojavljuju definisani nebitni segmenti.
3. **Generisanje (AI):** Poziva se v1beta Gemini API.
4. **Prikaz rezultata:** Ekstenzija otvara poseban lokalni tab gde prikazuje renderovan (bezbedan) Markdown, chat UI, potrošnju API-ja, i informacije o vremenu sačuvanom pomoću SponsorBlock-a.

## Struktura projekta

Evo potpunog pregleda fajlova i njihovih funkcija:

```text
yt_summary/
├── manifest.json          # MV3 konfiguracija ekstenzije i permisije
├── popup.html             # HTML struktura i UI popup prozora
├── popup.css              # Stilovi vezani direktno za popup meni
├── popup.js               # Osluškivači događaja (DOM) i glavni "orchestrator" aplikacije
├── gemini.js              # Sve HTTP POST interakcije, timeout i prompt rukovanje za Gemini API
├── transcript-fetcher.js  # 3 nivoa dohvaćanja transkripta izvršavana unutar "MAIN" world-a
├── transcript-parser.js   # Konvertovanje XML YouTube transkripata u JavaScript objekte
├── sponsor-filter.js      # API zahtevi i matematički overlap za SponsorBlock vremenske intervale
├── result.html            # Struktura punog novog taba u kojem se prikazuju rezultati
├── result.css             # UI/UX stilovi za glavni rezultat, tabele i chat
├── result.js              # Parsiranje i renderovanje Markdown-a u HTML, chat i regeneracija
├── DOCUMENTATION.md       # Razvojna i detaljna tehnička specifikacija arhitekture projekta
├── .gitattributes         # Kontrola text LF konfiguracija
├── .gitignore             # GIT ignore fajl
└── icons/                 # Direktorijum sa grafičkim ikonicama
```

## Instalacija

1. Klonirajte repozitorijum.
2. Otvorite Firefox pregledač i idite na `about:debugging#/runtime/this-firefox`.
3. Kliknite na **"Load Temporary Add-on"**.
4. Izaberite `manifest.json` iz direktorijuma projekta.

## Konfiguracija

Da bi ekstenzija radila, potreban vam je sopstveni API ključ:
1. Posetite [Google AI Studio](https://aistudio.google.com/app/apikey) i besplatno kreirajte Gemini ključ.
2. Unesite kreirani ključ u podešavanja ekstenzije u samom popup prozoru (klik na "Podešavanja"). Ključ se čuva isključivo lokalno.
