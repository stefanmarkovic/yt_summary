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
    "llm.js",
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
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
try {
    # Compress-Archive locks its sources, so Jest workers reading popup.html in parallel failed with EBUSY.
    # Sharing read/write access avoids that, and explicit "/" entry names are what Firefox expects.
    $archive = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($sourcePath in $sourcePaths) {
            $sourceFiles = if (Test-Path -LiteralPath $sourcePath -PathType Container) {
                Get-ChildItem -LiteralPath $sourcePath -File -Recurse
            } else {
                Get-Item -LiteralPath $sourcePath
            }
            foreach ($file in $sourceFiles) {
                $entryName = $file.FullName.Substring($PSScriptRoot.Length + 1).Replace('\', '/')
                $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                $source = [System.IO.File]::Open($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $target = $entry.Open()
                try { $source.CopyTo($target) } finally { $target.Dispose(); $source.Dispose() }
            }
        }
    }
    finally {
        $archive.Dispose()
    }
    Move-Item -LiteralPath $archivePath -Destination $destination -Force
    Write-Host "Extension packaged into $destination"
}
finally {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath
    }
}
