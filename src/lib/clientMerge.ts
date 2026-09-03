"use client";
// Client-side ffmpeg.wasm merge for YouTube DASH video+audio (no R2, free on single Vercel deploy)
// Uses @ffmpeg/ffmpeg + @ffmpeg/util. First load ~30MB WASM, then merge in Web Worker.

let ffmpeg: any = null;
let fetchFile: any = null;
let loading: Promise<any> | null = null;

async function getFFmpeg() {
  if (ffmpeg) return { ffmpeg, fetchFile };
  if (loading) return loading;
  loading = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile: ff } = await import("@ffmpeg/util");
    fetchFile = ff;
    ffmpeg = new FFmpeg();
    // Use CDN core (no need to bundle 30MB). Vercel will serve from cdn
    // jsDelivr CDN for ffmpeg core
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    ffmpeg.on("log", ({ message }: any) => console.log(`[ffmpeg] ${message}`));
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    console.log("[ffmpeg] loaded");
    return { ffmpeg, fetchFile };
  })();
  return loading;
}

export async function mergeVideoAudio(
  videoUrl: string,
  audioUrl: string,
  onProgress?: (pct: number, msg: string) => void,
): Promise<Blob> {
  const { ffmpeg: ff } = await getFFmpeg();
  onProgress?.(5, "fetching video+audio...");

  // Helper: fetch with real Content-Length progress, returns Uint8Array
  async function fetchBytes(url: string, label: string, weightStart: number, weightEnd: number, combinedTotal: number, getCombinedReceived: () => number): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${label} fetch ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        const combined = getCombinedReceived() + received;
        const pct = total && combinedTotal ? Math.round(weightStart + ((combined / combinedTotal) * (weightEnd - weightStart))) : weightStart;
        const mb = (received / 1024 / 1024).toFixed(1);
        const totalMb = total ? (total / 1024 / 1024).toFixed(1) : "?";
        const combinedMb = (combined / 1024 / 1024).toFixed(1);
        const combinedTotalMb = combinedTotal ? (combinedTotal / 1024 / 1024).toFixed(1) : "?";
        onProgress?.(pct, `${label} ${mb}/${totalMb} MB — combined ${combinedMb}/${combinedTotalMb} MB`);
      }
    }
    // concat
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // First do HEAD to get totals for combined progress (if available)
  let totalVideo = 0, totalAudio = 0;
  try {
    const [hv, ha] = await Promise.all([
      fetch(videoUrl, { method: "HEAD" }).then((r) => Number(r.headers.get("content-length") || 0)).catch(() => 0),
      fetch(audioUrl, { method: "HEAD" }).then((r) => Number(r.headers.get("content-length") || 0)).catch(() => 0),
    ]);
    totalVideo = hv; totalAudio = ha;
  } catch {}
  const combinedTotal = totalVideo + totalAudio;
  let receivedVideo = 0, receivedAudio = 0;

  // Fetch video then audio with combined progress — throttled to 1 log per 500ms or 1% to avoid spam
  let lastLog = 0;
  let lastPct = 0;
  function shouldLog(pct: number) {
    const now = Date.now();
    if (pct !== lastPct && (pct - lastPct >= 1 || now - lastLog > 600)) {
      lastPct = pct; lastLog = now; return true;
    }
    return false;
  }
  async function fetchWithRetry(url: string, retries = 1): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!r.body) throw new Error("no body");
        return r;
      } catch (e) {
        if (i === retries) throw e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw new Error("unreachable");
  }
  const videoData = await (async () => {
    const res = await fetchWithRetry(videoUrl, 1);
    totalVideo = Number(res.headers.get("content-length") || totalVideo);
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); received += value.length; receivedVideo = received;
        const combined = receivedVideo + receivedAudio;
        const pct = combinedTotal ? Math.round(10 + (combined / combinedTotal) * 40) : 10 + Math.min(40, Math.round(received / 1024 / 1024));
        if (shouldLog(pct)) onProgress?.(pct, `Downloading video ${(received/1024/1024).toFixed(1)}/${totalVideo ? (totalVideo/1024/1024).toFixed(1) : "?"} MB — combined ${(combined/1024/1024).toFixed(1)}/${combinedTotal ? (combinedTotal/1024/1024).toFixed(1) : "?"} MB`);
      }
    }
    const out = new Uint8Array(received); let off=0; for(const c of chunks){ out.set(c,off); off+=c.length; } return out;
  })();
  receivedVideo = videoData.length;
  const audioData = await (async () => {
    const res = await fetchWithRetry(audioUrl, 1);
    totalAudio = Number(res.headers.get("content-length") || totalAudio);
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); received += value.length; receivedAudio = received;
        const combined = receivedVideo + receivedAudio;
        const pct = combinedTotal ? Math.round(50 + (combined / combinedTotal) * 20) : 50 + Math.min(20, Math.round(received / 1024 / 1024));
        if (shouldLog(pct)) onProgress?.(pct, `Downloading audio ${(received/1024/1024).toFixed(1)}/${totalAudio ? (totalAudio/1024/1024).toFixed(1) : "?"} MB — combined ${(combined/1024/1024).toFixed(1)}/${combinedTotal ? (combinedTotal/1024/1024).toFixed(1) : "?"} MB`);
      }
    }
    const out = new Uint8Array(received); let off=0; for(const c of chunks){ out.set(c,off); off+=c.length; } return out;
  })();

  if (!videoData?.length || !audioData?.length) throw new Error(`fetch empty video=${videoData?.length} audio=${audioData?.length}`);
  onProgress?.(30, "loading files into ffmpeg...");
  await ff.writeFile("video.mp4", videoData);
  await ff.writeFile("audio.mp4", audioData);
  onProgress?.(50, "muxing video+audio (copy)...");
  // -c copy is fast, no re-encode
  await ff.exec(["-i", "video.mp4", "-i", "audio.mp4", "-c", "copy", "-shortest", "out.mp4"]);
  onProgress?.(85, "reading output...");
  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  // cleanup
  try {
    await ff.deleteFile("video.mp4");
    await ff.deleteFile("audio.mp4");
    await ff.deleteFile("out.mp4");
  } catch {}
  onProgress?.(95, "creating blob...");
  return new Blob([data as any], { type: "video/mp4" });
}

export async function isFFmpegSupported(): Promise<boolean> {
  try {
    // SharedArrayBuffer required for ffmpeg.wasm, needs crossOriginIsolated. Fallback still works with single thread?
    return typeof window !== "undefined";
  } catch {
    return false;
  }
}
