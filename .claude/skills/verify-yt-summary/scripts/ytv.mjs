#!/usr/bin/env node
// ytv — drive the YT Summary AI Firefox extension for verification.
// Zero dependencies: Node >= 22 (built-in WebSocket) + Firefox with WebDriver BiDi.
// One run = one daemon process that owns one Firefox instance, one BiDi session,
// one throwaway profile, and one evidence directory under <repo>/tmp/verify-runs/<runId>/.
// Usage: node .claude/skills/verify-yt-summary/scripts/ytv.mjs help

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const SKILL_DIR = path.resolve(path.dirname(SCRIPT), '..');
const REPO = path.resolve(SKILL_DIR, '..', '..', '..');
const RUNS = path.join(REPO, 'tmp', 'verify-runs');
const CURRENT = path.join(RUNS, 'current.json');
const EXT_ID = 'yt-summary-ai@stefan.local';
// Fixed internal UUID so moz-extension:// URLs are predictable for every run.
const EXT_UUID = '6f2b6d3e-0c51-4b8e-9a77-3e2d1f0a9b11';
const EXT_ORIGIN = `moz-extension://${EXT_UUID}`;
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------- utilities
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
function die(msg, code = 1) { console.error(`ytv: ${msg}`); process.exit(code); }
function readJson(p, fallback = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2)); }
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}
function findFirefox() {
  const candidates = [process.env.YTV_FIREFOX,
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/usr/bin/firefox', '/usr/local/bin/firefox', '/snap/bin/firefox'].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function pidImage(pid) {
  if (!IS_WIN) { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return pidAlive(pid) ? '?' : null; } }
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const m = out.match(/^"([^"]+)"/m);
    return m ? m[1] : null;
  } catch { return null; }
}
function killTree(pid) {
  if (!pidAlive(pid)) return;
  if (IS_WIN) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
}
// Firefox on Windows may hand off from the spawned launcher PID to a new browser process,
// so a run's browser is identified by its unique -profile path, never by process name.
function profilePids(profileDir) {
  const needle = path.basename(profileDir);
  try {
    if (IS_WIN) {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.CommandLine -notlike '*-contentproc*' } | ForEach-Object { $_.ProcessId }`;
      return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
    }
    return execFileSync('pgrep', ['-f', needle], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}
async function killRunFirefox(profileDir, spawnedPid) {
  killTree(spawnedPid);
  for (let i = 0; i < 3; i++) {
    const pids = profilePids(profileDir);
    if (!pids.length) return true;
    pids.forEach(killTree);
    await sleep(1000);
  }
  return profilePids(profileDir).length === 0;
}
function parseFlags(argv) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}
function extUrl(u) { return u.startsWith('ext:') ? `${EXT_ORIGIN}/${u.slice(4).replace(/^\//, '')}` : u; }

// =================================================================== DAEMON
async function daemon(runId) {
  const runDir = path.join(RUNS, runId);
  const statePath = path.join(runDir, 'state.json');
  const state = readJson(statePath);
  const logFile = path.join(runDir, 'daemon.log');
  const log = (...a) => fs.appendFileSync(logFile, `[${now()}] ${a.join(' ')}\n`);
  const redactRec = rec => (rec.flags?.env || /api-key/i.test(String(rec.args?.[1] || ''))) && rec.cmd === 'type'
    ? { ...rec, args: [rec.args[0], rec.args[1], rec.flags?.env ? `<from env ${rec.flags.env}>` : '<redacted>'] } : rec;
  const journal = rec => fs.appendFileSync(path.join(runDir, 'journal.jsonl'), JSON.stringify({ ts: now(), ...redactRec(rec) }) + '\n');
  const setState = patch => { Object.assign(state, patch); writeJson(statePath, state); };

  try {
    const profile = state.profileDir;
    fs.mkdirSync(profile, { recursive: true });
    const dl = path.join(runDir, 'downloads');
    fs.mkdirSync(dl, { recursive: true });
    const prefs = {
      'extensions.webextensions.uuids': JSON.stringify({ [EXT_ID]: EXT_UUID }),
      'browser.shell.checkDefaultBrowser': false,
      'browser.startup.homepage_override.mstone': 'ignore',
      'browser.aboutwelcome.enabled': false,
      'datareporting.policy.dataSubmissionEnabled': false,
      'toolkit.telemetry.reportingpolicy.firstRun': false,
      'media.autoplay.default': 5,
      'browser.download.dir': dl,
      'browser.download.folderList': 2,
      'browser.download.useDownloadDir': true,
      'browser.download.always_ask_before_handling_new_types': false,
      'browser.download.start_downloads_in_tmp_dir': false,
      'browser.download.alwaysOpenPanel': false,
      'print.always_print_silent': true,
    };
    fs.writeFileSync(path.join(profile, 'user.js'),
      Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');

    const bidiPort = await freePort();
    const args = ['-profile', profile, '-no-remote', '--remote-allow-system-access', `--remote-debugging-port=${bidiPort}`];
    if (!state.headed) args.push('--headless');
    const ffLog = fs.openSync(path.join(runDir, 'firefox.log'), 'a');
    const ff = spawn(state.firefox, args, {
      stdio: ['ignore', ffLog, ffLog], detached: !IS_WIN, windowsHide: true,
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    });
    setState({ firefoxPid: ff.pid, bidiPort });
    log(`firefox pid=${ff.pid} bidiPort=${bidiPort}`);

    // Wait for BiDi to listen.
    let ws;
    for (let i = 0; i < 120 && !ws; i++) {
      await sleep(500);
      try {
        const sock = new WebSocket(`ws://127.0.0.1:${bidiPort}/session`);
        await new Promise((res, rej) => { sock.addEventListener('open', res); sock.addEventListener('error', rej); });
        ws = sock;
      } catch { /* not yet */ }
    }
    if (!ws) throw new Error('Firefox never opened its WebDriver BiDi port (see firefox.log)');

    let nextId = 0; const pending = new Map();
    const handlers = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.type === 'error' ? p.rej(new Error(`${m.error}: ${m.message}`)) : p.res(m.result); }
      else if (m.type === 'event') for (const h of handlers) { try { h(m); } catch (e) { log('handler error', e.stack); } }
    });
    ws.addEventListener('close', () => { log('bidi socket closed'); setState({ bidiClosed: true }); });
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++nextId; pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const sess = await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: false } } });
    const install = await send('webExtension.install', { extensionData: { type: 'path', path: state.src } });
    log(`session ${sess.sessionId} firefox ${sess.capabilities.browserVersion}; installed ${install.extension}`);
    setState({ browserVersion: sess.capabilities.browserVersion, extensionId: install.extension });

    // Console + errors from every page (extension pages included) -> console.jsonl
    await send('session.subscribe', { events: ['log.entryAdded', 'network.beforeRequestSent', 'browsingContext.contextCreated', 'browsingContext.userPromptOpened'] });
    handlers.push(m => {
      if (m.method === 'log.entryAdded') {
        const p = m.params;
        fs.appendFileSync(path.join(runDir, 'console.jsonl'), JSON.stringify({ ts: now(), level: p.level, type: p.type, text: p.text, url: p.source?.context }) + '\n');
      }
      if (m.method === 'browsingContext.userPromptOpened') {
        // alert()/confirm() from the extension: record and accept so the page does not hang.
        const p = m.params;
        fs.appendFileSync(path.join(runDir, 'prompts.jsonl'), JSON.stringify({ ts: now(), type: p.type, message: p.message, context: p.context }) + '\n');
        send('browsingContext.handleUserPrompt', { context: p.context, accept: true }).catch(e => log('prompt handle failed', e.message));
      }
    });

    // ---- LLM stub at the network boundary (only in --llm stub) ----
    const llmHosts = ['openrouter.ai'];
    if (state.llm === 'stub') {
      await send('network.addDataCollector', { dataTypes: ['request'], maxEncodedDataSize: 50_000_000 });
      await send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: llmHosts.map(hostname => ({ type: 'pattern', protocol: 'https', hostname })) });
      handlers.push(m => {
        if (m.method !== 'network.beforeRequestSent' || !m.params.isBlocked) return;
        const req = m.params.request;
        (async () => {
          let rec = { ts: now(), url: req.url, method: req.method };
          try {
            if (req.method === 'OPTIONS') {
              await send('network.provideResponse', { request: req.request, statusCode: 204, reasonPhrase: 'No Content', headers: corsHeaders() });
              return;
            }
            let bodyText = '';
            try { bodyText = (await send('network.getData', { dataType: 'request', request: req.request })).bytes.value; } catch (e) { rec.bodyError = e.message; }
            const reply = stubReply(req.url, bodyText);
            rec = { ...rec, ...reply.record };
            await send('network.provideResponse', {
              request: req.request, statusCode: 200, reasonPhrase: 'OK',
              headers: [{ name: 'Content-Type', value: { type: 'string', value: 'application/json' } }, ...corsHeaders()],
              body: { type: 'string', value: JSON.stringify(reply.json) },
            });
            rec.status = 200;
          } catch (e) {
            rec.error = e.message; log('stub failure', e.stack);
            try { await send('network.provideResponse', { request: req.request, statusCode: 500, reasonPhrase: 'ytv stub error', body: { type: 'string', value: '{"error":{"message":"ytv stub error"}}' } }); } catch { /* request gone */ }
          } finally {
            fs.appendFileSync(path.join(runDir, 'llm-requests.jsonl'), JSON.stringify(rec) + '\n');
          }
        })();
      });
    }

    // ---- helpers over BiDi ----
    async function contexts() { return (await send('browsingContext.getTree', { maxDepth: 0 })).contexts; }
    async function resolve(target) {
      if (!target) throw new Error('missing <target> (context id or URL substring, e.g. popup.html, result.html, youtube.com)');
      if (target === 'chrome') return (await send('browsingContext.getTree', { maxDepth: 0, 'moz:scope': 'chrome' })).contexts[0].context;
      const all = await contexts();
      const exact = all.find(c => c.context === target);
      if (exact) return exact.context;
      const hits = all.filter(c => c.url.includes(target));
      if (!hits.length) throw new Error(`no tab matches "${target}". Open tabs: ${all.map(c => c.url).join(' | ')}`);
      return hits[hits.length - 1].context; // newest match
    }
    async function evaluate(ctx, expression) {
      const r = await send('script.evaluate', {
        expression: `(async () => { const __v = await (${expression}); return JSON.stringify(__v === undefined ? null : __v); })()`,
        target: { context: ctx }, awaitPromise: true, resultOwnership: 'none',
      });
      if (r.type === 'exception') throw new Error(`page exception: ${r.exceptionDetails.text}`);
      return JSON.parse(r.result.value);
    }
    async function element(ctx, css) {
      const r = await send('script.callFunction', {
        functionDeclaration: '(css) => { const el = document.querySelector(css); if (!el) throw new Error("no element for selector " + css); el.scrollIntoView({block:"center"}); return el; }',
        arguments: [{ type: 'string', value: css }], target: { context: ctx }, awaitPromise: true, resultOwnership: 'root',
      });
      if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
      return r.result.sharedId;
    }
    // Firefox BiDi refuses input.performActions on privileged (moz-extension://) pages, so
    // extension pages get DOM-dispatched events; web pages (YouTube) get real input.
    // browsingContext.activate is refused there too, so extension tabs are never activated.
    const isExtCtx = async ctx => (await contexts()).find(c => c.context === ctx)?.url.startsWith('moz-extension://');
    async function domClick(ctx, css) {
      return evaluate(ctx, `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) throw new Error('no element ' + ${JSON.stringify(css)}); el.scrollIntoView({block:'center'}); el.focus(); el.click(); return { clicked: ${JSON.stringify(css)}, method: 'dom', disabled: !!el.disabled }; })()`);
    }
    async function realClick(ctx, css) {
      if (await isExtCtx(ctx)) return domClick(ctx, css);
      await send('browsingContext.activate', { context: ctx });
      const sharedId = await element(ctx, css);
      await send('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
        { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId } } },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
      await send('input.releaseActions', { context: ctx });
      return { clicked: css, method: 'pointer' };
    }
    async function typeText(ctx, css, text) {
      if (await isExtCtx(ctx)) {
        return evaluate(ctx, `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) throw new Error('no element ' + ${JSON.stringify(css)}); el.focus(); el.value = ''; for (const ch of ${JSON.stringify([...text])}) { el.value += ch; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' })); } el.dispatchEvent(new Event('change', { bubbles: true })); return { typed: ${JSON.stringify(css)}, method: 'dom', length: el.value.length }; })()`);
      }
      await realClick(ctx, css);
      const mod = process.platform === 'darwin' ? '\uE03D' : '\uE009';
      const keys = [{ type: 'keyDown', value: mod }, { type: 'keyDown', value: 'a' }, { type: 'keyUp', value: 'a' }, { type: 'keyUp', value: mod },
        { type: 'keyDown', value: '\uE003' }, { type: 'keyUp', value: '\uE003' }];
      for (const ch of [...text]) keys.push({ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch });
      await send('input.performActions', { context: ctx, actions: [{ type: 'key', id: 'kbd', actions: keys }] });
      await send('input.releaseActions', { context: ctx });
      return { typed: css, method: 'keyboard' };
    }
    async function withProbe(fn) {
      // Background extension tab used only to read storage/runtime; closed afterwards.
      const { context } = await send('browsingContext.create', { type: 'tab', background: true });
      try {
        await send('browsingContext.navigate', { context, url: `${EXT_ORIGIN}/result.html?id=__ytv_probe`, wait: 'complete' });
        return await fn(context);
      } finally { await send('browsingContext.close', { context }).catch(() => {}); }
    }
    let shotSeq = 0;

    const commands = {
      async doctor() {
        const ctxs = await contexts();
        const srcManifest = readJson(path.join(state.src, 'manifest.json'), {});
        const probe = await withProbe(c => evaluate(c, `browser.storage.local.get('llm_config').then(d => ({
          version: browser.runtime.getManifest().version,
          id: browser.runtime.id,
          defaultModel: typeof DEFAULT_MODEL === 'string' ? DEFAULT_MODEL : null,
          normalizeLlmConfig: typeof normalizeLlmConfig,
          configured: !!d.llm_config?.apiKey
        }))`));
        const problems = [];
        if (!profilePids(state.profileDir).length) problems.push('no firefox.exe is running with this run profile');
        if (probe.version !== srcManifest.version) problems.push(`loaded version ${probe.version} != source manifest ${srcManifest.version}`);
        if (!probe.defaultModel || probe.normalizeLlmConfig !== 'function') problems.push('source is inconsistent: popup.js needs DEFAULT_MODEL and normalizeLlmConfig from llm.js, but they are missing; the popup will throw on open');
        return {
          ok: problems.length === 0, problems, runId, src: state.src, llm: state.llm, headed: !!state.headed,
          firefox: { spawnedPid: state.firefoxPid, browserPids: profilePids(state.profileDir), version: state.browserVersion, bidiPort: state.bidiPort },
          extension: { id: probe.id, version: probe.version, defaultModel: probe.defaultModel, apiKeyConfigured: probe.configured, origin: EXT_ORIGIN },
          tabs: ctxs.map(c => c.url),
        };
      },
      async tabs() { return (await contexts()).map(c => ({ context: c.context, url: c.url })); },
      async open([url], flags) {
        const { context } = await send('browsingContext.create', { type: 'tab', background: !!flags.background });
        const nav = await send('browsingContext.navigate', { context, url: extUrl(url), wait: 'complete' });
        return { context, url: nav.url };
      },
      async goto([target, url]) { const ctx = await resolve(target); return send('browsingContext.navigate', { context: ctx, url: extUrl(url), wait: 'complete' }); },
      async activate([target]) {
        const ctx = await resolve(target);
        if (await isExtCtx(ctx)) throw new Error('Firefox BiDi cannot activate moz-extension:// tabs (privileged scope). Activate the web tab you need instead.');
        await send('browsingContext.activate', { context: ctx }); return { activated: ctx };
      },
      async close([target]) { const ctx = await resolve(target); await send('browsingContext.close', { context: ctx }); return { closed: ctx }; },
      async eval([target, expr]) { return evaluate(await resolve(target), expr); },
      async wait([target, expr], flags) {
        const timeout = Number(flags.timeout || 30000); const t0 = Date.now(); let last;
        while (Date.now() - t0 < timeout) {
          try { const ctx = await resolve(target); last = await evaluate(ctx, expr); if (last) return { ok: true, value: last, ms: Date.now() - t0 }; }
          catch (e) { last = `error: ${e.message}`; }
          await sleep(250);
        }
        throw new Error(`timed out after ${timeout}ms waiting for ${expr} (last: ${JSON.stringify(last)})`);
      },
      async click([target, css]) { return realClick(await resolve(target), css); },
      async 'dom-click'([target, css]) { return domClick(await resolve(target), css); },
      async type([target, css, text]) { return typeText(await resolve(target), css, text ?? ''); },
      async select([target, css, value]) {
        const ctx = await resolve(target);
        return evaluate(ctx, `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) throw new Error('no element'); if (![...el.options].some(o => o.value === ${JSON.stringify(value)})) throw new Error('no option ' + ${JSON.stringify(value)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return el.value; })()`);
      },
      async text([target, css]) {
        const ctx = await resolve(target);
        return evaluate(ctx, `(() => { const el = document.querySelector(${JSON.stringify(css)}); return el ? (el.value !== undefined && el.tagName !== 'BUTTON' ? el.value : el.textContent.trim()) : null; })()`);
      },
      async shot([target, name]) {
        const ctx = await resolve(target);
        const { data } = await send('browsingContext.captureScreenshot', { context: ctx, origin: 'document' });
        const file = path.join(runDir, `${String(++shotSeq).padStart(2, '0')}-${(name || 'shot').replace(/[^\w.-]+/g, '_')}.png`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        return { file };
      },
      async storage([name]) {
        const dump = await withProbe(c => evaluate(c, `Promise.all([browser.storage.local.get(null), browser.storage.session.get(null)]).then(([local, session]) => ({ local, session }))`));
        const redact = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'apiKey' && v ? `<redacted:${String(v).length} chars>` : v)));
        const file = path.join(runDir, `storage-${(name || 'dump').replace(/[^\w.-]+/g, '_')}.json`);
        writeJson(file, redact(dump));
        return { file, localKeys: Object.keys(dump.local), sessionKeys: Object.keys(dump.session) };
      },
      async 'llm-log'() {
        const f = path.join(runDir, 'llm-requests.jsonl');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
      },
      async downloads() { return fs.readdirSync(dl).map(f => ({ file: path.join(dl, f), bytes: fs.statSync(path.join(dl, f)).size })); },
    };

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', async () => {
        const { cmd, args = [], flags = {} } = body ? JSON.parse(body) : {};
        const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/ping') return reply(200, { runId });
        if (req.url === '/stop') { reply(200, { stopping: true }); setTimeout(shutdown, 50); return; }
        const fn = commands[cmd];
        if (!fn) return reply(400, { error: `unknown command ${cmd}` });
        try { const result = await fn(args, flags); journal({ cmd, args, flags, ok: true, result }); reply(200, { result }); }
        catch (e) { journal({ cmd, args, flags, ok: false, error: e.message }); reply(500, { error: e.message }); }
      });
    });
    const ctlPort = await freePort();
    server.listen(ctlPort, '127.0.0.1');

    async function shutdown() {
      log('shutdown requested');
      try { await Promise.race([send('session.end', {}), sleep(3000)]); } catch { /* ignore */ }
      await killRunFirefox(profile, ff.pid);
      for (let i = 0; i < 20; i++) {
        try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(500); }
      }
      setState({ stoppedAt: now(), ready: false, profileRemoved: !fs.existsSync(profile) });
      log('stopped');
      server.close(); process.exit(0);
    }
    ff.on('exit', code => { log(`spawned firefox pid exited code=${code} (on Windows the launcher may hand off to a new browser pid)`); });

    setState({ ready: true, ctlPort, daemonPid: process.pid, readyAt: now() });
    log(`ready ctlPort=${ctlPort}`);
  } catch (e) {
    log('FATAL', e.stack);
    setState({ fatal: e.message });
    await killRunFirefox(state.profileDir, state.firefoxPid);
    process.exit(1);
  }
}

function corsHeaders() {
  return [
    { name: 'Access-Control-Allow-Origin', value: { type: 'string', value: '*' } },
    { name: 'Access-Control-Allow-Headers', value: { type: 'string', value: '*' } },
    { name: 'Access-Control-Allow-Methods', value: { type: 'string', value: 'POST, OPTIONS' } },
  ];
}

// Deterministic fake LLM. Every answer carries "[ytv-stub]" so evidence can never be
// mistaken for a real model, and summaries quote the transcript the extension sent,
// which proves the real transcript reached the LLM boundary.
function stubReply(url, bodyText) {
  const body = JSON.parse(bodyText || '{}');
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find(m => m.role === 'system')?.content || '';
  const user = messages.at(-1)?.content || '';
  const transcript = (system.split('Transkript YouTube videa:\n')[1] || '').split('\n\nInstrukcija:')[0].split('\nZvanična poglavlja')[0];
  const head = transcript.replace(/\s+/g, ' ').trim().slice(0, 120);
  const detail = system.includes('Kratak rezime.') ? '1' : system.includes('Veoma detaljan rezime.') ? '3' : system.includes('Srednji rezime sa buletima.') ? '2' : null;
  const chunk = system.match(/Ovo je deo (\d+) transkripta/)?.[1] || null;
  let task; let text;
  if (user === 'Generiši JSON.') { task = 'entities'; text = '["ytv-stub entity A", "ytv-stub entity B"]'; }
  else if (user === 'Generiši JSON kviz.') {
    task = 'quiz';
    text = JSON.stringify([
      { question: '[ytv-stub] Which option is correct?', options: ['Correct', 'Wrong'], answerIndex: 0 },
      { question: '[ytv-stub] Pick the second option.', options: ['First', 'Second', 'Third'], answerIndex: 1 },
    ]);
  } else if (user === 'Generiši.') {
    task = chunk ? `summary-chunk-${chunk}` : `summary-detail-${detail}`;
    const bullets = detail === '1' ? 1 : detail === '3' ? 5 : 3;
    text = `TL;DR: [ytv-stub] detail ${detail} summary.\n\n## [ytv-stub] Summary (detail ${detail})\n\n`
      + Array.from({ length: bullets }, (_, i) => `- Point ${i + 1} [0:0${i}]`).join('\n')
      + `\n\nTranscript starts: "${head}"`;
  } else { task = 'chat'; text = `[ytv-stub] answer to: ${user}`; }
  const usage = { prompt: Math.ceil(system.length / 4), output: Math.ceil(text.length / 4) };
  const json = { choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: usage.prompt, completion_tokens: usage.output, cost: (usage.prompt + usage.output) * 1e-7 } };
  const model = body.model || null;
  return { json, record: { task, model, transcriptChars: transcript.length, transcriptHead: head, userMessage: user.slice(0, 200), reply: text.slice(0, 200) } };
}

// ====================================================================== CLI
function currentRun(flags) {
  const runId = flags.run || process.env.YTV_RUN || readJson(CURRENT)?.runId;
  if (!runId) die('no active run. Start one with: ytv launch');
  const state = readJson(path.join(RUNS, runId, 'state.json'));
  if (!state) die(`run ${runId} has no state.json`);
  return { runId, state, runDir: path.join(RUNS, runId) };
}
async function call(state, cmd, args = [], flags = {}) {
  const res = await fetch(`http://127.0.0.1:${state.ctlPort}/cmd`, { method: 'POST', body: JSON.stringify({ cmd, args, flags }) })
    .catch(e => die(`daemon for run ${state.runId} is not answering on port ${state.ctlPort} (${e.cause?.code || e.message}). Run "ytv doctor" or "ytv stop".`));
  const out = await res.json();
  if (out.error) die(out.error, 2);
  return out.result;
}

async function launch(flags) {
  const firefox = findFirefox();
  if (!firefox) die('Firefox not found; set YTV_FIREFOX to firefox.exe');
  const src = path.resolve(flags.src || REPO);
  if (!fs.existsSync(path.join(src, 'manifest.json'))) die(`no manifest.json in ${src}`);
  const llm = flags.llm === 'live' ? 'live' : 'stub';
  const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}-${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.join(RUNS, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const state = { runId, src, llm, headed: !!flags.headed, firefox, profileDir: path.join(os.tmpdir(), `ytv-profile-${runId}`), createdAt: now() };
  writeJson(path.join(runDir, 'state.json'), state);
  const out = fs.openSync(path.join(runDir, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [SCRIPT, '__daemon', runId], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const s = readJson(path.join(runDir, 'state.json'), {});
    if (s.fatal) die(`launch failed: ${s.fatal} (see ${path.join(runDir, 'daemon.log')})`);
    if (s.ready) {
      writeJson(CURRENT, { runId });
      console.log(`READY run=${runId} firefox=${s.browserVersion} llm=${llm} headed=${!!flags.headed}\n  src=${src}\n  evidence=${runDir}`);
      return;
    }
  }
  die(`launch timed out; see ${path.join(runDir, 'daemon.log')}`);
}

async function stop(flags) {
  const { runId, state, runDir } = currentRun(flags);
  const ok = await fetch(`http://127.0.0.1:${state.ctlPort}/stop`, { method: 'POST' }).then(() => true).catch(() => false);
  for (let i = 0; i < 60 && ok && pidAlive(state.daemonPid); i++) await sleep(250);
  // Fallback: kill only the processes this run recorded, after checking they are still ours.
  const s = readJson(path.join(runDir, 'state.json'), state);
  if (pidAlive(s.daemonPid) && /node/i.test(pidImage(s.daemonPid) || '')) killTree(s.daemonPid);
  const firefoxGone = await killRunFirefox(s.profileDir, pidAlive(s.firefoxPid) && /firefox/i.test(pidImage(s.firefoxPid) || '') ? s.firefoxPid : null);
  for (let i = 0; i < 10 && fs.existsSync(s.profileDir); i++) {
    try { fs.rmSync(s.profileDir, { recursive: true, force: true }); } catch { await sleep(500); }
  }
  if (readJson(CURRENT)?.runId === runId) fs.rmSync(CURRENT, { force: true });
  console.log(JSON.stringify({ stopped: runId, firefoxGone, profileRemoved: !fs.existsSync(s.profileDir), evidence: runDir }, null, 2));
}

const HELP = `ytv — drive the YT Summary AI extension in a throwaway Firefox (WebDriver BiDi)

  launch [--src DIR] [--headed] [--llm stub|live]   start Firefox + daemon, install extension from DIR (default: repo root)
  doctor                       is this run worth driving? (process, version, source consistency, tabs)
  tabs                         list tabs (context id + URL)
  open <url|ext:page> [--background]   new tab; ext:popup.html -> ${EXT_ORIGIN}/popup.html
  goto <target> <url>          navigate an existing tab
  activate <target>            make a tab the active one (popup reads the ACTIVE tab)
  close <target>               close a tab
  click <target> <css>         real pointer click (activates the tab first)
  dom-click <target> <css>     element.click() without activating (use for the popup while YouTube stays active)
  type <target> <css> <text>   real click + select-all + keystrokes (extension pages: DOM input events)
                               --env NAME types the value of env var NAME (secrets never hit argv or the journal)
  select <target> <css> <value>  choose a <select> option and fire change
  text <target> <css>          value of an input or trimmed textContent
  eval <target> <js-expr>      evaluate in the page (await-able), prints JSON
  wait <target> <js-expr> [--timeout ms]   poll until truthy
  shot <target> <name>         screenshot -> evidence dir
  storage [name]               dump browser.storage.local+session (apiKey redacted) -> evidence dir
  llm-log                      LLM requests the stub answered (task, model, transcript head)
  downloads                    files the extension downloaded in this run
  stop                         end session, kill this run's Firefox, delete profile; evidence stays

<target> = tab context id or a URL substring (newest match wins): popup.html, result.html, playlist.html, youtube.com
Global: --run <runId> (default: tmp/verify-runs/current.json, or env YTV_RUN)
Evidence: ${RUNS}/<runId>/ (journal.jsonl, console.jsonl, llm-requests.jsonl, prompts.jsonl, *.png, storage-*.json, downloads/)`;

const [cmd, ...argv] = process.argv.slice(2);
const { flags, rest } = parseFlags(argv);
if (cmd === '__daemon') await daemon(rest[0]);
else if (!cmd || cmd === 'help' || cmd === '--help') console.log(HELP);
else if (cmd === 'launch') await launch(flags);
else if (cmd === 'stop') await stop(flags);
else {
  const { state } = currentRun(flags);
  if (cmd === 'doctor' && !pidAlive(state.daemonPid)) {
    console.log(JSON.stringify({ ok: false, problems: [`daemon pid ${state.daemonPid} is not running (stopped: ${state.stoppedAt || 'no'}, fatal: ${state.fatal || 'none'})`], strayBrowserPids: profilePids(state.profileDir) }, null, 2));
    process.exit(1);
  }
  if (cmd === 'type' && flags.env) {
    if (!process.env[flags.env]) die(`env var ${flags.env} is empty`);
    rest[2] = process.env[flags.env];
  }
  const result = await call(state, cmd, rest, flags);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (cmd === 'doctor' && !result.ok) process.exit(1);
}
