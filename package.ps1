$files = @(
    "manifest.json",
    "popup.html",
    "popup.js",
    "popup.css",
    "result.html",
    "result.js",
    "result.css",
    "gemini.js",
    "transcript-fetcher.js",
    "transcript-parser.js",
    "sponsor-filter.js",
    "icons"
)

$dest = "yt-summary-firefox.xpi"
if (Test-Path $dest) { Remove-Item $dest }

Compress-Archive -Path $files -DestinationPath $dest
Write-Host "Extension packaged into $dest"
if (Test-Path "yt-summary-firefox.zip") { Remove-Item "yt-summary-firefox.zip" }
