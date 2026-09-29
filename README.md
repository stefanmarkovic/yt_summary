# YT Summary AI

Firefox ekstenzija (Manifest V3, verzija 4.4.1) za sažimanje YouTube videa pomoću Google Gemini ili OpenRouter servisa. Jezik interfejsa i jezik AI odgovora biraju se nezavisno.

## Šta podržava

- Kratak, srednji i detaljan sažetak; standardni stil, ugrađene persone i sopstveni šabloni.
- Dohvat postojećih YouTube titlova kroz paralelne API pokušaje i DOM rezervni put.
- SponsorBlock filtriranje, vremenske oznake i procenu izostavljenog vremena.
- Chat, kviz, izdvajanje entiteta, oblak ključnih reči i ponovno sažimanje.
- Grupnu obradu videa pronađenih na stranici liste.
- Kopiranje teksta/Markdowna i izvoz u HTML, Markdown za Notion ili PDF preko dijaloga za štampu.

Ekstenzija ne prepoznaje govor iz zvuka: video mora imati dostupan transkript. Grupna obrada ne učitava automatski celu listu ako YouTube prikazuje samo njen deo.

## Instalacija i podešavanje

1. U Firefoxu otvorite `about:debugging#/runtime/this-firefox`.
2. Kliknite **Load Temporary Add-on** i izaberite `manifest.json`.
3. U podešavanjima izaberite provajdera i unesite njegov API ključ.
4. Za Gemini izaberite `gemini-3.7-flash` ili `gemini-3.5-flash-lite`. Za OpenRouter unesite model slug ili koristite `openrouter/auto`.
5. Otvorite YouTube video, podesite detaljnost, stil i jezik odgovora, pa pokrenite generisanje.

Ključ i podešavanja ostaju u lokalnom skladištu ekstenzije. Transkript i pitanja šalju se izabranom AI servisu; SponsorBlock dobija ID videa. Prikazana cena je procena, a stvarni račun zavisi od provajdera i uslova naloga.

## Razvoj i provera

Potreban je Node.js sa npm-om; za XPI pakovanje potreban je PowerShell (`powershell.exe` na Windowsu, `pwsh` za integration test na drugim sistemima).

```sh
npm ci
npm test -- --runInBand
npm run lint
npm run package
```

`npm test` uključuje ESLint za aplikaciju i testove, zatim Jest. Test pakovanja pokreće stvarni PowerShell skript iz drugog direktorijuma i proverava sadržaj nastalog XPI-ja. `npm run package` pravi `yt-summary-firefox.xpi` sa isključivo runtime fajlovima. `npm start` pokreće razvojnu Firefox sesiju preko web-ext-a.

`node_modules`, privremeni logovi, coverage i generisani paketi ne pripadaju Git repozitorijumu. Zavisnosti se obnavljaju iz `package-lock.json` komandom `npm ci`.

## Struktura

| Oblast | Fajlovi |
| --- | --- |
| Podešavanja i pokretanje | `popup.js`, `popup.html`, `popup.css` |
| Dohvat i filtriranje | `transcript-fetcher.js`, `transcript-pipeline.js` |
| AI transport i instrukcije | `gemini.js`, `prompts.js` |
| Rezultat i lista | `result.js/html/css`, `playlist.js/html` |
| Bezbedan prikaz | `markdown-renderer.js`, `summary-renderer.js` |
| Dodatne funkcije | `chat.js`, `quiz.js`, `i18n.js` |
| Konfiguracija i pakovanje | `manifest.json`, `package.json`, `package.ps1`, `.eslintrc.json` |
| Provere | `tests/` |

Detalji i ograničenja: [tehnička dokumentacija](DOCUMENTATION.md). Kratko objašnjenje za korisnika: [docs.html](docs.html). Nalazi i urađene izmene: [audit-report.html](audit-report.html).
