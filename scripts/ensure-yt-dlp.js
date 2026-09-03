#!/usr/bin/env node
// Ensures yt-dlp_linux standalone binary exists on Vercel (no python3 needed)
// Runs at build time via vercel.json buildCommand. Also safe to run locally.
const fs = require("fs");
const path = require("path");
const https = require("https");

const BIN_DIR = path.join(__dirname, "../node_modules/yt-dlp-exec/bin");
const BIN_PATH = path.join(BIN_DIR, "yt-dlp_linux");
const FALLBACK_PATH = path.join(BIN_DIR, "yt-dlp");
const URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

async function ensure() {
  try {
    if (fs.existsSync(BIN_PATH)) {
      const st = fs.statSync(BIN_PATH);
      if (st.size > 1000000) {
        fs.chmodSync(BIN_PATH, 0o755);
        console.log(`[ensure-yt-dlp] already exists at ${BIN_PATH} (${st.size} bytes)`);
        return;
      } else {
        console.log(`[ensure-yt-dlp] existing ${BIN_PATH} is too small (${st.size} bytes), re-downloading`);
        fs.unlinkSync(BIN_PATH);
      }
    }
    console.log(`[ensure-yt-dlp] downloading ${URL} -> ${BIN_PATH} ...`);
    fs.mkdirSync(BIN_DIR, { recursive: true });
    // Use fetch with redirect follow (Node 18+)
    const res = await fetch(URL, { headers: { "User-Agent": "mediamover-build" }, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000000) throw new Error(`download too small ${buf.length}`);
    fs.writeFileSync(BIN_PATH, buf, { mode: 0o755 });
    fs.chmodSync(BIN_PATH, 0o755);
    const st = fs.statSync(BIN_PATH);
    console.log(`[ensure-yt-dlp] downloaded ${st.size} bytes to ${BIN_PATH}`);
  } catch (e) {
    console.warn(`[ensure-yt-dlp] failed: ${e.message || e}`);
    // don't fail build, runtime will try /tmp download
  }
}

ensure();
