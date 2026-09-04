// src/lib/handlers/youtubeStepper.ts
//
// Splits YouTube extraction into small ordered "steps". One step = one poll =
// one Vercel invocation, always well under the 10s Hobby limit. State (which
// step we're on, and any formats found so far) lives on the DB row, so it
// survives across invocations naturally — no external worker needed.

import { pickAllFormats } from "./utils/pickAllFormats";
import { getCookiesPath } from "./utils/cookies";
import { getFetchDispatcher } from "./utils/proxy";
import { ensureYtDlpPath } from "../ensureYtDlp";

type Step =
  | { type: "piped"; host: string }
  | { type: "ytdlp"; client: string; free: boolean; withCookies?: boolean };

// Order matters: cheapest / most-likely-to-work first. "tv" client currently
// doesn't require YouTube's PO token, so it goes first.
export const YOUTUBE_STEPS: Step[] = [
  { type: "ytdlp", client: "tv", free: true },
  { type: "ytdlp", client: "default", free: true },
  { type: "piped", host: "https://pipedapi.kavin.rocks" },
  { type: "piped", host: "https://pipedapi.adminforge.de" },
  { type: "ytdlp", client: "android", free: true },
  { type: "ytdlp", client: "tv", free: true, withCookies: true },
];

// Per-step budget. Keep this well under 10s to leave room for DB read/write
// and cold-start overhead. 6s is a safe ceiling for a single yt-dlp attempt.
const STEP_TIMEOUT_MS = 6000;

const MIN_FORMATS_TO_STOP_EARLY = 4;

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function runPipedStep(host: string, url: string, jobId: string): Promise<any[]> {
  const vid = extractVideoId(url);
  if (!vid) return [];
  try {
    const dispatcher = (() => { try { return getFetchDispatcher(); } catch { return undefined; } })();
    const opts: any = { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(STEP_TIMEOUT_MS) };
    if (dispatcher) opts.dispatcher = dispatcher;
    const r = await fetch(`${host}/streams/${vid}`, opts);
    if (!r.ok) { console.warn(`[stepper] piped ${host} http ${r.status} for ${jobId}`); return []; }
    const pj: any = await r.json();
    const streams: any[] = [...(pj.videoStreams || []), ...(pj.audioStreams || [])];
    return streams
      .filter((s: any) => s.url)
      .map((s: any) => ({
        url: s.url,
        quality: s.quality || (s.height ? `${s.height}p` : "best"),
        height: s.height || parseInt(s.quality) || undefined,
        ext: (s.mimeType || "video/mp4").split("/")[1]?.split(";")[0] || "mp4",
        hasAudio: !!s.audioTrackName || s.mimeType?.includes("audio") || false,
        needsMerge: false,
        title: (pj.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video",
        size: s.bitrate ? `${(s.bitrate / 8000 / 1024).toFixed(1)} MB` : undefined,
        thumbnail: pj.thumbnailUrl || "",
      }))
      .filter((v: any) => v.height)
      .sort((a: any, b: any) => b.height - a.height)
      .slice(0, 8);
  } catch (e) {
    console.warn(`[stepper] piped ${host} failed for ${jobId}`, String(e).slice(0, 120));
    return [];
  }
}

async function runYtDlpStep(step: Extract<Step, { type: "ytdlp" }>, url: string, jobId: string): Promise<any[]> {
  try {
    ensureYtDlpPath();
    const cookiesPath = step.withCookies ? getCookiesPath(jobId) : null;
    if (step.withCookies && !cookiesPath) return [];

    const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
    const args: any = {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
      ...(step.free ? { preferFreeFormats: true } : {}),
      ...(cookiesPath ? { cookies: cookiesPath } : {}),
    };
    if (step.client !== "web" && step.client !== "default") {
      args.extractorArgs = `youtube:player_client=${step.client}`;
    }

    // Strip proxy env for yt-dlpexec to avoid dead proxy hijack (same logic as youtube.ts)
    const stripProxyEnv = () => {
      const next: Record<string, string | undefined> = { ...process.env };
      for (const k of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "no_proxy", "NO_PROXY"]) delete next[k];
      return next;
    };

    const result: any = await Promise.race([
      ytdlp(url, args, { env: stripProxyEnv(), extendEnv: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("yt-dlp step timeout")), STEP_TIMEOUT_MS)),
    ]);

    return pickAllFormats(result, 8);
  } catch (e: any) {
    console.warn(`[stepper] ytdlp ${step.client}${step.withCookies ? " +cookies" : ""} failed for ${jobId}`, String(e?.stderr || e?.message || e).slice(0, 200));
    return [];
  }
}

/**
 * Runs exactly ONE step. Call this once per poll.
 * Returns the merged best-so-far formats and whether the search is finished
 * (either enough formats found, or every step exhausted).
 */
export async function runOneYoutubeStep(
  url: string,
  jobId: string,
  stepIndex: number,
  partialFormats: any[]
): Promise<{ formats: any[]; nextStepIndex: number; done: boolean }> {
  if (stepIndex >= YOUTUBE_STEPS.length) {
    return { formats: partialFormats, nextStepIndex: stepIndex, done: true };
  }

  const step = YOUTUBE_STEPS[stepIndex];
  const found = step.type === "piped"
    ? await runPipedStep(step.host, url, jobId)
    : await runYtDlpStep(step, url, jobId);

  const merged = found.length > partialFormats.length ? found : partialFormats;
  const nextStepIndex = stepIndex + 1;
  const done = merged.length >= MIN_FORMATS_TO_STOP_EARLY || nextStepIndex >= YOUTUBE_STEPS.length;

  console.log(`[stepper] job=${jobId} step=${stepIndex}(${step.type}) found=${found.length} merged=${merged.length} done=${done}`);
  return { formats: merged, nextStepIndex, done };
}
