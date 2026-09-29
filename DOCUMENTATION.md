# YT Summary AI — tehnička dokumentacija

Firefox Manifest V3 ekstenzija, verzija 4.4.1. Nema background worker-a: popup pokreće analizu, a stranice rezultata i liste upravljaju svojim aktivnim zahtevima. Zatvaranje tih stranica može prekinuti posao.

## Granice modula

| Modul | Odgovornost i interfejs |
| --- | --- |
| `popup.js` | Podešavanja, validacija YouTube URL-a, pronalaženje ID-jeva liste, pokretanje analize i stvaranje zasebnih session snapshotova. |
| `transcript-fetcher.js` | Samostalna `fetchTranscriptInPageContext(videoId)`, ubrizgana preko `scripting.executeScript({world: "MAIN"})`; vraća `{status, segments, chapters, debugLines}`. Sva potrebna logika je unutar funkcije jer Firefox serijalizuje funkciju za page kontekst. |
| `transcript-pipeline.js` | `getProcessedTranscript(tabId, videoId)`, `getSponsorSegments(videoId)` i zajednička `processTranscriptSegments(segments, sponsors, chapters, debugLines)`. Dohvat, validacija, filtriranje, formatiranje i session keš. |
| `prompts.js` | `buildSystemInstruction(transcript, taskSpec)` i `resolvePersona(value, customPrompts)`. TL;DR je uključen samo za zadatke sa `summary: true`; JSON zadaci ne dobijaju instrukcije za Markdown ili vremenske oznake. |
| `gemini.js` | Konfiguracija dozvoljenih provajdera, autentifikacija, transport, retry, parsiranje odgovora, potrošnja i zadaci: sažetak, dugi sažetak, entiteti, kviz i chat. |
| `markdown-renderer.js` | `escapeHtml`, `markdownToHtml`, `setSafeHTML`. Tekst se escape-uje, kod se štiti od Markdown transformacija, a umetnuti HTML se dodatno sanitizuje. |
| `summary-renderer.js` | Zajednička kartica za rezultat i listu: TL;DR, tekst, entiteti, SponsorBlock statistika, potrošnja i YouTube timestamp linkovi. |
| `result.js` | Učitava snapshot sa svojim ID-jem; kopiranje, izvoz, regeneracija i izdvajanje entiteta koriste taj rezultat. |
| `playlist.js` | Direktan dohvat YouTube stranice i InnerTube transkripta; rezervni YouTube prozor; zajedničko filtriranje i renderovanje za svaki video. |
| `chat.js`, `quiz.js` | Istorija chata i kontrola jednog zahteva; validacija i prikaz kviza sa odvojenim radio grupama. |
| `i18n.js` | Jezik interfejsa: engleski, srpski, nemački i španski. Jezik AI odgovora je zasebno podešavanje. |

## Tok analize

1. Popup validira aktivni YouTube URL i video ID.
2. MAIN funkcija paralelno pokušava captionTracks i InnerTube; DOM pokušaj kreće nakon 150 ms. Prvi uspešan rezultat završava dohvat. Ukupan deadline je 8 s; AbortController zaustavlja mrežu, DOM čekanja i posmatrače preostalih pokušaja.
3. Podaci player-a se proveravaju prema video ID-ju kako stari SPA podaci ne bi postali transkript novog videa. Parser podržava JSON događaje, XML `text` i timed-text `p` segmente.
4. SponsorBlock kreće paralelno sa transkriptom. Njegov deadline je 350 ms; mrežna greška, nevalidan odgovor ili nedostupan servis vraćaju praznu listu.
5. Zajednička obrada odbacuje nevalidne segmente i raspone, sortira titlove, filtrira i dodaje `[MM:SS]` oznake. Prazan rezultat zaustavlja analizu pre AI poziva.
6. AI transport šalje instrukcije i transkript izabranom provajderu. Rezultat i transkript dobijaju zaseban session ključ; popup otvara stranicu sa ID-jem tog ključa.

MAIN je glavni kontekst YouTube stranice, sa pristupom njenim promenljivama i cookie-jima; nije izolovani content-script kontekst. Rezervni put liste može otvoriti mali pozadinski YouTube prozor, koji se zatvara u `finally` bloku.

## SponsorBlock: izbor teksta i statistika

Filtriraju se kategorije `sponsor`, `selfpromo`, `interaction`, `intro` i `outro`. Raspon mora biti numerički, nenegativan i imati kraj posle početka.

Ceo titl se uklanja ako se najmanje polovina njegovog trajanja preklapa sa unijom SponsorBlock raspona. Kratak presek na granici tako više ne briše celu korisnu rečenicu. Za titlove bez trajanja ono se izvodi iz narednog titla kada je moguće; preostali segment bez trajanja proverava se po početnoj tački.

`savedSeconds` je trajanje unije uklonjenih titlova, bez duplog brojanja preklopa. `categoryStats` predstavlja uniju prijavljenih SponsorBlock raspona za svaku kategoriju. To su različite mere: zbir kategorija može da se razlikuje od uklonjenog vremena i kategorije mogu međusobno da se preklapaju. Filtriranje nije precizno sečenje po rečima.

Session keš čuva poslednji obrađeni video do šest sati. Nevalidan, budući ili istekao timestamp i prazan tekst ne koriste se; kvar keša ne obara analizu.

## AI zahtevi

Provajderi su fiksni:

- Gemini: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`, modeli `gemini-3.7-flash` i `gemini-3.5-flash-lite`.
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer`, slobodan model slug i podrazumevani `openrouter/auto`.

Transport odbija druge provajdere i proizvoljne URL-ove. Migracija starih podešavanja čuva kompatibilan ključ za dozvoljenog provajdera, a briše ključ uklonjenog provajdera. Konfiguracija normalizuje pozitivan kontekst i opsege temperature/topP; nula je validna vrednost za sampling.

Rok pojedinačnog AI zahteva je 180 s. HTTP 502/503/504 imaju do dva ponavljanja sa eksponencijalnim odlaganjem; ostale greške i timeout prikazuju se pozivaocu. Parsiranje spaja tekstualne delove Gemini odgovora i razlikuje odgovor bez teksta/safety block od sintaksne greške. JSON tekst se čisti od spoljnog code fence-a, a entiteti i kviz dodatno proveravaju očekivanu strukturu.

Dugi transkript se deli približno po rečenicama/rečima i sažima redom. Ako zbir delimičnih sažetaka ne staje u kontekst, grupno se dodatno sažima do četiri prolaza. Ako se tekst ne smanjuje ili i dalje ne staje, prikazuje se greška umesto tihog odbacivanja poslednjih delova videa. Broj karaktera je približna procena tokena, a ne tokenizacija provajdera; veoma velika istorija chata i instrukcije i dalje mogu prekoračiti limit.

## Skladište i odvojeni rezultati

| Oblast | Ključ | Sadržaj |
| --- | --- | --- |
| `local` | `llm_config` | Ključ, provajder, model, jezici i sampling podešavanja. |
| `local` | `custom_templates` | Korisnički šabloni persona. |
| `local` | `total_usage` | Ukupni tokeni i zbir procenjenog troška. |
| `local` | `yt_summary_result` | Poslednji sažetak kao kompatibilni prikaz; bez API ključa i transkripta. |
| `local` | `yt_debug_logs` | Debug log poslednjeg procesa. |
| `session` | `yt_result_<UUID>` | `{result, transcript}` za `result.html?id=<UUID>`. |
| `session` | `yt_batch_<UUID>` | Privremena konfiguracija i ID-jevi posla za `playlist.html?id=<UUID>`; briše se po završetku. |
| `session` | `yt_transcript_cache` | Jedan obrađeni video, rezultat i vreme keširanja. |

Stranica rezultata ne dobija API ključ u sačuvanom rezultatu; za novi zahtev učitava lokalnu konfiguraciju. Novi rezultat čuva UUID analize, izabrani model, personu, detaljnost i izlazni jezik. Lokalni poslednji sažetak ažurira se samo kada se poklapa UUID analize, uključujući dve analize istog videa. Stara stranica bez ID-ja može prikazati poslednji sažetak, ali ne povezuje nasumični stari transkript sa njim. Session snapshotovi rezultata nestaju pri završetku browser sesije; ne postoji trajna istorija svih transkripata niti automatski cleanup pri zatvaranju pojedinačnog taba.

Upis potrošnje serijalizovan je unutar jedne stranice i kvar skladišta ne odbacuje već dobijen AI odgovor. Ne postoji globalna transakcija između više otvorenih stranica: istovremeni read/modify/write zahtevi u različitim tabovima mogu izgubiti deo zbirne statistike. Prikazana potrošnja pojedinačnog odgovora ostaje dostupna.

## Cena i izvori

Na datum provere 29.09.2026. plaćeni standardni Gemini tarif je, po milion tokena:

| Model | Ulaz | Izlaz, uključujući thinking tokene |
| --- | --- | --- |
| Gemini 3.7 Flash, do 31.12.2026. | $0.75 | $3.75 |
| Gemini 3.7 Flash, od 01.01.2027. | $1.50 | $7.50 |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 |

Kod uključuje prelaz cene 3.7 Flash od 2027. i thinking tokene u izlaznu potrošnju. OpenRouter koristi prijavljeni trošak kada ga odgovor sadrži; ako izostane, prikazana vrednost nije pouzdan račun. Besplatni nivo, caching, popusti i buduće promene tarife nisu obračun provajdera.

Izvori: [zvanični Gemini modeli](https://ai.google.dev/gemini-api/docs/models) i [Gemini cenovnik](https://ai.google.dev/gemini-api/docs/pricing), provereni 29.09.2026.

## Testovi i pakovanje

`npm ci` obnavlja razvojne zavisnosti iz lock fajla. `npm test -- --runInBand` prvo proverava ESLint za aplikaciju i testove, zatim pokreće Jest. `npm run lint` pokreće web-ext proveru runtime ekstenzije.

Testovi koriste stvarne module, mockovane browser/API granice, DOM i fake timere. Browser-page smoke test učitava stvarne script reference iz tri HTML stranice u njihovom redosledu, bez CommonJS globalnih izvoza. To proverava browser vezivanje modula u JSDOM-u; ne zamenjuje instalaciju u Firefoxu i live YouTube proveru.

`package.ps1` koristi eksplicitnu listu runtime resursa, putanje iz `PSScriptRoot` i privremeni ZIP koji preimenuje u XPI. Prethodni paket se zamenjuje tek posle uspešnog arhiviranja. Integration test proverava stvarnu arhivu, reference resursa, verziju i očuvanje prethodnog paketa pri grešci.

Dokumentacija, HTML izveštaj, testovi, development konfiguracija i `node_modules` ne ulaze u XPI. [HTML izveštaj pregleda](audit-report.html) sadrži završne rezultate provera i preostala ograničenja.
