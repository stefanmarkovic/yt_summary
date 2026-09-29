/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('Firefox package', () => {
  let directory;
  let entries;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-summary-package-'));
    const archivePath = path.join(directory, 'extension.xpi');
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const packageResult = spawnSync(shell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve(__dirname, '../package.ps1'), '-OutputPath', archivePath
    ], { cwd: directory, encoding: 'utf8', timeout: 30_000 });
    if (packageResult.status !== 0) {
      throw new Error(packageResult.error?.message || packageResult.stderr || packageResult.stdout);
    }

    // Use the platform ZIP reader to inspect the real Firefox artifact.
    const inspectResult = spawnSync(shell, ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $archive = [System.IO.Compression.ZipFile]::OpenRead($env:TEST_XPI_PATH)
      try {
        @($archive.Entries | ForEach-Object {
          $text = $null
          if ($_.FullName -match '\\.(html|json)$') {
            $reader = New-Object System.IO.StreamReader($_.Open())
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
          }
          @{ name = $_.FullName.Replace('\\', '/'); text = $text }
        }) | ConvertTo-Json -Compress
      } finally { $archive.Dispose() }
    `], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, TEST_XPI_PATH: archivePath }
    });
    if (inspectResult.status !== 0) {
      throw new Error(inspectResult.error?.message || inspectResult.stderr);
    }
    entries = JSON.parse(inspectResult.stdout.trim().replace(/^\uFEFF/, ''));
  }, 60_000);

  afterAll(() => {
    if (directory && path.dirname(directory) === os.tmpdir()
      && path.basename(directory).startsWith('yt-summary-package-')) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('contains a root manifest with the current package version', () => {
    const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').text);
    expect(manifest.version).toBe(require('../package.json').version);
    expect(entries.map(entry => entry.name)).toContain(manifest.action.default_popup);
  });

  test('includes every local resource referenced by extension pages and icons', () => {
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries.filter(item => item.name.endsWith('.html'))) {
      const localResources = Array.from(entry.text.matchAll(/(?:src|href)="([^"#]+)"/g))
        .map(match => match[1]).filter(resource => !/^[a-z]+:/i.test(resource));
      for (const resource of localResources) {
        expect(names.has(resource)).toBe(true);
      }
    }
    const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').text);
    for (const icon of Object.values(manifest.icons)) {
      expect(names.has(icon)).toBe(true);
    }
  });

  test('excludes development dependencies, tests and documentation', () => {
    expect(entries.some(entry => /(^|\/)(node_modules|tests|reports)\//.test(entry.name))).toBe(false);
    expect(entries.some(entry => /\.(md|ps1)$/.test(entry.name))).toBe(false);
    const excluded = ['package.json', 'package-lock.json', 'docs.html', 'audit-report.html', 'opencode.json'];
    expect(entries.filter(entry => excluded.includes(entry.name))).toEqual([]);
    expect(fs.readdirSync(directory)).toEqual(['extension.xpi']);
  });

  test('preserves the existing artifact when a source resource is missing', () => {
    const incompleteDirectory = path.join(directory, 'incomplete');
    fs.mkdirSync(incompleteDirectory);
    const scriptPath = path.join(incompleteDirectory, 'package.ps1');
    fs.copyFileSync(path.resolve(__dirname, '../package.ps1'), scriptPath);
    const archivePath = path.join(incompleteDirectory, 'existing.xpi');
    fs.writeFileSync(archivePath, 'previous successful package');

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const result = spawnSync(shell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-OutputPath', archivePath
    ], { encoding: 'utf8', timeout: 30_000 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing extension resource');
    expect(fs.readFileSync(archivePath, 'utf8')).toBe('previous successful package');
    expect(fs.readdirSync(incompleteDirectory).sort()).toEqual(['existing.xpi', 'package.ps1']);
  });
});
