/**
 * Monkeyeffect built-in Thai TTS server
 * เสียงพูดอยู่ในโปรแกรม — ไม่ใช้เสียง Windows
 */
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MONKEY_TTS_PORT || 3848);
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH = 11644473600;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";

const BUILTIN_VOICES = [
  { id: "th-google", name: "ไทย AI (ในโปรแกรม)", gender: "Female", locale: "th-TH", engine: "google" },
  { id: "th-TH-PremwadeeNeural", name: "Premwadee (หญิง · Neural)", gender: "Female", locale: "th-TH", engine: "edge" },
  { id: "th-TH-NiwatNeural", name: "Niwat (ชาย · Neural)", gender: "Male", locale: "th-TH", engine: "edge" },
  { id: "th-TH-AcharaNeural", name: "Achara (หญิง · Neural)", gender: "Female", locale: "th-TH", engine: "edge" },
];

const synthCache = new Map();
const SYNTH_CACHE_MAX = 48;

function uuidNoDash() {
  return crypto.randomUUID().replace(/-/g, "");
}

function generateSecMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = Math.floor((ticks * 1e9) / 100);
  return crypto.createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest("hex").toUpperCase();
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rateToProsody(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return "+0%";
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function buildSsml(text, voice, rate) {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='th-TH'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rateToProsody(rate)}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

function synthesizeEdge(text, voice, rate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const connectionId = uuidNoDash();
    const secMsGec = generateSecMsGec();
    const url =
      `wss://${BASE}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}` +
      `&ConnectionId=${connectionId}`;

    const chunks = [];
    let settled = false;

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(data);
    };

    const ws = new WebSocket(url, {
      host: "speech.platform.bing.com",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });

    const timer = setTimeout(() => finish(new Error("Edge TTS timeout")), timeoutMs);

    ws.on("open", () => {
      ws.send(
        [
          `X-RequestId:${uuidNoDash()}`,
          "Content-Type:application/json; charset=utf-8",
          "Path:speech.config",
          "",
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`,
        ].join("\r\n")
      );
      ws.send(
        [
          `X-RequestId:${uuidNoDash()}`,
          "Content-Type:application/ssml+xml",
          `X-Timestamp:${new Date().toString()}`,
          "Path:ssml",
          "",
          buildSsml(text, voice, rate),
        ].join("\r\n")
      );
    });

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const textMsg = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        if (textMsg.includes("Path:turn.end")) {
          if (!chunks.length) finish(new Error("Edge TTS empty audio"));
          else finish(null, Buffer.concat(chunks));
        }
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (headerLen < 0 || buf.length < 2 + headerLen) return;
      const header = buf.subarray(2, 2 + headerLen).toString("utf8");
      const audio = buf.subarray(2 + headerLen);
      if (/Path:audio/i.test(header) && audio.length) chunks.push(audio);
    });

    ws.on("error", (err) => finish(err));
    ws.on("close", () => {
      if (!settled) {
        if (chunks.length) finish(null, Buffer.concat(chunks));
        else finish(new Error("Edge TTS closed"));
      }
    });
  });
}

async function synthesizeGoogle(text) {
  const chunkSize = 180;
  const slices = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    slices.push(text.slice(i, i + chunkSize));
  }
  const parts = await Promise.all(
    slices.map(async (slice) => {
      const url =
        "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=th&q=" +
        encodeURIComponent(slice);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://translate.google.com/",
        },
      });
      if (!res.ok) throw new Error(`Google TTS HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    })
  );
  if (!parts.length) throw new Error("Google TTS empty");
  return Buffer.concat(parts);
}

async function synthesize(text, voiceId, rate) {
  const voice = BUILTIN_VOICES.find((v) => v.id === voiceId) || BUILTIN_VOICES[0];
  const cacheKey = `${voice.id}|${rate}|${text}`;
  const cached = synthCache.get(cacheKey);
  if (cached) return cached;
  let audio;
  if (voice.engine === "google") {
    audio = await synthesizeGoogle(text);
  } else {
    try {
      audio = await synthesizeEdge(text, voice.id, rate);
    } catch (err) {
      console.warn("[TTS] Edge failed → Google:", err.message || err);
      audio = await synthesizeGoogle(text);
    }
  }
  if (synthCache.size >= SYNTH_CACHE_MAX) {
    const first = synthCache.keys().next().value;
    if (first) synthCache.delete(first);
  }
  synthCache.set(cacheKey, audio);
  return audio;
}

/** Play mp3 outside WebView so minimized UI still speaks. */
let playChain = Promise.resolve();

function playMp3File(filePath) {
  const uri = "file:///" + String(filePath).replace(/\\/g, "/").replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName PresentationCore",
    "$m = New-Object System.Windows.Media.MediaPlayer",
    `$m.Open([Uri]'${uri}')`,
    "Start-Sleep -Milliseconds 80",
    "$m.Play()",
    "$deadline = (Get-Date).AddSeconds(90)",
    "while (-not $m.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }",
    "if ($m.NaturalDuration.HasTimeSpan) {",
    "  while ($m.Position -lt $m.NaturalDuration.TimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 80 }",
    "} else { Start-Sleep -Seconds 4 }",
    "try { $m.Stop(); $m.Close() } catch {}",
  ].join("; ");
  return execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { windowsHide: true, timeout: 100000, maxBuffer: 2 * 1024 * 1024 }
  );
}

function enqueuePlayMp3(buffer) {
  const job = playChain.then(async () => {
    const file = path.join(os.tmpdir(), `monkey-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`);
    fs.writeFileSync(file, buffer);
    try {
      await playMp3File(file);
    } finally {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  });
  playChain = job.catch(() => {});
  return job;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "Monkeyeffect TTS", voices: BUILTIN_VOICES.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/voices") {
    sendJson(res, 200, { voices: BUILTIN_VOICES });
    return;
  }

  if (req.method === "POST" && url.pathname === "/speak") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const text = String(body.text || "").trim();
      if (!text) {
        sendJson(res, 400, { error: "ไม่มีข้อความ" });
        return;
      }
      const voice = BUILTIN_VOICES.some((v) => v.id === body.voice)
        ? body.voice
        : "th-google";
      const rate = Number(body.rate) || 1;
      const audio = await synthesize(text.slice(0, 800), voice, rate);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(audio);
    } catch (err) {
      console.error("[TTS] speak error:", err);
      sendJson(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  // Synthesize + play on the TTS process (works even if main window is minimized).
  if (req.method === "POST" && url.pathname === "/speak-play") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const text = String(body.text || "").trim();
      if (!text) {
        sendJson(res, 400, { error: "ไม่มีข้อความ" });
        return;
      }
      const voice = BUILTIN_VOICES.some((v) => v.id === body.voice)
        ? body.voice
        : "th-google";
      const rate = Number(body.rate) || 1;
      const audio = await synthesize(text.slice(0, 800), voice, rate);
      await enqueuePlayMp3(audio);
      sendJson(res, 200, { ok: true, played: true, bytes: audio.length });
    } catch (err) {
      console.error("[TTS] speak-play error:", err);
      sendJson(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[Monkeyeffect TTS] http://127.0.0.1:${PORT}`);
});

server.on("error", (err) => {
  console.error("[Monkeyeffect TTS] failed:", err.message);
  process.exit(1);
});
