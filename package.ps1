$files = @(
    "manifest.json",
    "popup.html",
    "popup.js",
    "popup.css",
    "result.html",
    "result.js",
    "result.css",
    "playlist.html",
    "playlist.js",
    "gemini.js",
    "transcript-fetcher.js",
    "transcript-pipeline.js",
    "markdown-renderer.js",
    "summary-renderer.js",
    "i18n.js",
    "prompts.js",
    "chat.js",
    "quiz.js",
    "icons"
)

$dest = "yt-summary-firefox.xpi"
if (Test-Path $dest) { Remove-Item $dest }

Compress-Archive -Path $files -DestinationPath $dest
Write-Host "Extension packaged into $dest"
if (Test-Path "yt-summary-firefox.zip") { Remove-Item "yt-summary-firefox.zip" }
