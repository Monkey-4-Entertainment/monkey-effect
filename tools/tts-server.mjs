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
  { id: "th-TH-PremwadeeNeural", name: "Premwadee (หญิง)", gender: "Female", locale: "th-TH", engine: "edge" },
  { id: "th-TH-NiwatNeural", name: "Niwat (ชาย)", gender: "Male", locale: "th-TH", engine: "edge" },
  { id: "th-TH-AcharaNeural", name: "Achara (หญิง)", gender: "Female", locale: "th-TH", engine: "edge" },
  { id: "en-US-AvaMultilingualNeural", name: "Ava (หญิง · หลายภาษา)", gender: "Female", locale: "en-US", engine: "edge" },
  { id: "en-US-AndrewMultilingualNeural", name: "Andrew (ชาย · หลายภาษา)", gender: "Male", locale: "en-US", engine: "edge" },
  { id: "en-US-EmmaMultilingualNeural", name: "Emma (หญิง · หลายภาษา)", gender: "Female", locale: "en-US", engine: "edge" },
  { id: "en-US-BrianMultilingualNeural", name: "Brian (ชาย · หลายภาษา)", gender: "Male", locale: "en-US", engine: "edge" },
  { id: "zh-CN-XiaoxiaoMultilingualNeural", name: "Xiaoxiao (หญิง · จีน)", gender: "Female", locale: "zh-CN", engine: "edge" },
  { id: "th-google", name: "ไทย AI สำรอง", gender: "Female", locale: "th-TH", engine: "google" },
];

const TRANSLATE_LANGS = new Set([
  "en", "zh-CN", "ja", "ko", "vi", "id", "ms", "lo", "km", "my",
  "es", "fr", "de", "ru", "ar", "hi", "pt", "th",
]);

function resolveVoice(voiceId) {
  const known = BUILTIN_VOICES.find((v) => v.id === voiceId);
  if (known) return known;
  if (/^[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+Neural$/.test(String(voiceId || ""))) {
    return { id: voiceId, engine: "edge" };
  }
  return BUILTIN_VOICES[0];
}

const synthCache = new Map();
const SYNTH_CACHE_MAX = 48;
let latestSub = { at: 0, original: "", lines: [] };

function prepareSpeechForTranslation(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  s = s.replace(/กดหัวใจรัว+ๆ?\s*ให้หน่อยได้ไหม/gu, "กดปุ่มไลก์รัวๆ ได้ไหม");
  s = s.replace(/กดหัวใจรัว+ๆ?/gu, "กดปุ่มไลก์รัวๆ");
  s = s.replace(/กดหัวใจ/gu, "กดปุ่มไลก์");
  s = s.replace(/ส่งหัวใจ/gu, "ส่งไลก์");
  return s;
}

function compactLetters(s) {
  return String(s || "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function sourceCovered(sent, origJoined) {
  const a = compactLetters(sent);
  const b = compactLetters(origJoined);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  if (shorter / longer < 0.9) return false;
  return a.includes(b) || b.includes(a);
}

async function translateOne(text, target, source) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx" +
    `&sl=${encodeURIComponent(source || "auto")}` +
    `&tl=${encodeURIComponent(target)}` +
    "&dt=t&dj=1&ie=UTF-8&oe=UTF-8&q=" +
    encodeURIComponent(text);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  const raw = await res.text();
  if (!res.ok || raw.trim().startsWith("<")) throw new Error(`แปลภาษาไม่สำเร็จ (${res.status})`);
  const data = JSON.parse(raw);
  const parts = (Array.isArray(data.sentences) ? data.sentences : []).filter((s) => typeof s.trans === "string");
  const translated = parts.map((s) => s.trans).join("").replace(/\s{2,}/g, " ").trim();
  const original = parts.filter((s) => s.orig).map((s) => s.orig).join("");
  if (!translated) throw new Error("คำแปลว่าง");
  if (!sourceCovered(text, original)) throw new Error("คำแปลไม่ครบประโยค");
  return { text: translated, detected: data.src || source || "" };
}

async function translateMany(text, targets, source) {
  const prepared = prepareSpeechForTranslation(text);
  const unique = [...new Set((targets || []).filter((id) => TRANSLATE_LANGS.has(id)))].slice(0, 6);
  const lines = [];
  const errors = [];
  for (const id of unique) {
    if (source && id === source) continue;
    let line = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !line; attempt++) {
      try {
        const result = await translateOne(prepared, id, source || "auto");
        line = { id, text: result.text, detected: result.detected };
      } catch (err) {
        lastErr = err;
      }
    }
    if (line) lines.push(line);
    else errors.push({ id, error: lastErr?.message || "แปลไม่สำเร็จ" });
  }
  return { prepared, lines, errors };
}

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

function buildSsml(text, voice, rate, lang) {
  const xmlLang = /^[a-z]{2,3}-[A-Za-z]{2}$/.test(String(lang || "")) ? lang : "th-TH";
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${xmlLang}'>` +
    `<voice name='${voice}' xml:lang='${xmlLang}'>` +
    `<prosody rate='${rateToProsody(rate)}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

function synthesizeEdge(text, voice, rate, lang = "th-TH", timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const connectionId = uuidNoDash();
    const secMsGec = generateSecMsGec();
    const url =
      `wss://${BASE}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}` +
      `&ConnectionId=${connectionId}`;

    const chunks = [];
    let settled = false;
    let timer = null;

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

    let endArmed = false;
    const armEnd = (waitMs) => {
      endArmed = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!chunks.length) finish(new Error("Edge TTS empty audio"));
        else finish(null, Buffer.concat(chunks));
      }, waitMs);
    };

    timer = setTimeout(() => finish(new Error("Edge TTS timeout")), timeoutMs);

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
          buildSsml(text, voice, rate, lang),
        ].join("\r\n")
      );
    });

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const textMsg = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        if (textMsg.includes("Path:turn.end")) {
          armEnd(chunks.length ? 450 : 900);
        }
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (headerLen < 0 || buf.length < 2 + headerLen) return;
      const header = buf.subarray(2, 2 + headerLen).toString("utf8");
      const audio = buf.subarray(2 + headerLen);
      if (/Path:audio/i.test(header) && audio.length) {
        chunks.push(audio);
        if (endArmed) armEnd(250);
      }
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

async function synthesize(text, voiceId, rate, lang = "th-TH") {
  const voice = resolveVoice(voiceId);
  const cacheKey = `${voice.id}|${rate}|${lang}|${text}`;
  const cached = synthCache.get(cacheKey);
  if (cached) return cached;
  let audio;
  if (voice.engine === "google") {
    audio = await synthesizeGoogle(text);
  } else {
    try {
      audio = await synthesizeEdge(text, voice.id, rate, lang);
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
  const ps1 = `${filePath}.ps1`;
  const pathLit = String(filePath).replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "using System.Text;",
    "public static class MonkeyMci {",
    "  [DllImport(\"winmm.dll\", CharSet = CharSet.Unicode)]",
    "  public static extern int mciSendString(string command, StringBuilder ret, int retLen, IntPtr hwnd);",
    "}",
    "'@",
    "$alias = 'mek' + [guid]::NewGuid().ToString('N').Substring(0, 8)",
    `$path = '${pathLit}'`,
    "$sb = New-Object System.Text.StringBuilder 32",
    "[void][MonkeyMci]::mciSendString(\"close $alias\", $sb, 32, [IntPtr]::Zero)",
    "$open = [MonkeyMci]::mciSendString(('open \"' + $path + '\" type mpegvideo alias ' + $alias), $sb, 32, [IntPtr]::Zero)",
    "if ($open -ne 0) { throw \"mci open $open\" }",
    "$play = [MonkeyMci]::mciSendString(('play ' + $alias + ' wait'), $sb, 32, [IntPtr]::Zero)",
    "[void][MonkeyMci]::mciSendString(('close ' + $alias), $sb, 32, [IntPtr]::Zero)",
    "if ($play -ne 0) { throw \"mci play $play\" }",
  ].join("\r\n");
  fs.writeFileSync(ps1, script, "utf8");
  return execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { windowsHide: true, timeout: 100000, maxBuffer: 2 * 1024 * 1024 }
  ).finally(() => {
    try {
      fs.unlinkSync(ps1);
    } catch {
      /* ignore */
    }
  });
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
      const voice = resolveVoice(body.voice).id;
      const rate = Number(body.rate) || 1;
      const lang = /^[a-z]{2,3}-[A-Za-z]{2}$/.test(String(body.lang || "")) ? String(body.lang) : "th-TH";
      const audio = await synthesize(text.slice(0, 800), voice, rate, lang);
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
      const voice = resolveVoice(body.voice).id;
      const rate = Number(body.rate) || 1;
      const lang = /^[a-z]{2,3}-[A-Za-z]{2}$/.test(String(body.lang || "")) ? String(body.lang) : "th-TH";
      const audio = await synthesize(text.slice(0, 800), voice, rate, lang);
      await enqueuePlayMp3(audio);
      sendJson(res, 200, { ok: true, played: true, bytes: audio.length });
    } catch (err) {
      console.error("[TTS] speak-play error:", err);
      sendJson(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/translate") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const text = String(body.text || "").trim();
      if (!text) {
        sendJson(res, 400, { error: "ไม่มีข้อความ" });
        return;
      }
      const source = TRANSLATE_LANGS.has(body.source) ? body.source : "auto";
      const targets = Array.isArray(body.targets) ? body.targets.map((id) => String(id)) : [];
      const result = await translateMany(text.slice(0, 500), targets, source === "auto" ? "" : source);
      if (!result.lines.length) {
        sendJson(res, 422, { error: result.errors[0]?.error || "แปลไม่สำเร็จ", errors: result.errors });
        return;
      }
      latestSub = {
        at: Date.now(),
        original: text,
        lines: result.lines,
        showOriginal: body.showOriginal !== false,
      };
      sendJson(res, 200, { ok: true, original: text, lines: result.lines, errors: result.errors });
    } catch (err) {
      console.error("[TTS] translate error:", err);
      sendJson(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/subtitle") {
    sendJson(res, 200, latestSub);
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
