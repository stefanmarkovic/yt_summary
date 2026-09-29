param(
    [string] $OutputPath = (Join-Path $PSScriptRoot "yt-summary-firefox.xpi")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Ship only files needed by the extension, never tests, reports or dependencies.
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

$sourcePaths = $files | ForEach-Object {
    $sourcePath = Join-Path $PSScriptRoot $_
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Missing extension resource: $_"
    }
    $sourcePath
}

$destination = [System.IO.Path]::GetFullPath($OutputPath)
$archivePath = [System.IO.Path]::ChangeExtension($destination, "$([guid]::NewGuid()).zip")
try {
    # Compress-Archive accepts .zip, while Firefox expects the same ZIP as .xpi.
    Compress-Archive -LiteralPath $sourcePaths -DestinationPath $archivePath -CompressionLevel Optimal
    Move-Item -LiteralPath $archivePath -Destination $destination -Force
    Write-Host "Extension packaged into $destination"
}
finally {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath
    }
}
