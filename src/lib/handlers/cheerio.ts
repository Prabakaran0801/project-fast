import * as cheerio from "cheerio";
import { cheerioHeadersFor } from "./utils/fetchHtml";

export async function cheerioCrawl(url: string, jobId: string): Promise<{ detected: any[]; pageTitle: string }> {
  let detected: any[] = [];
  let pageTitle = "";
  const headers = cheerioHeadersFor(url);
  async function fetchHtml(target: string, timeoutMs: number) {
    return fetch(target, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  }
  for (let attempt = 0; attempt < 2 && detected.length === 0; attempt++) {
    try {
      const res = await fetchHtml(url, 15000);
      if (!res.ok) {
        console.warn(`[cheerio] http ${res.status} ${res.headers.get("cf-mitigated") || ""} for ${jobId}`);
        if (attempt === 0 && (res.status === 403 || res.status === 429 || res.status === 503)) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        break;
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      pageTitle = $("title").first().text().trim().slice(0, 120);
      $("video source, video, meta[property='og:video'], meta[property='og:video:secure_url'], source[src], [data-src], [data-video-url]").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("content") || $(el).attr("srcset") || $(el).attr("data-src") || $(el).attr("data-video-url");
        if (src && !src.startsWith("blob:") && !src.startsWith("data:")) {
          try {
            const abs = new URL(src, url).toString();
            const ext = abs.split(".").pop()?.split("?")[0]?.toLowerCase() || "mp4";
            if (["mp4", "webm", "mov", "m3u8"].includes(ext)) detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
          } catch {}
        }
      });
      if (detected.length === 0) {
        const patterns = [
          /["']contentUrl["']\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
          /["']video_url["']\s*:\s*["']([^"']+)["']/gi,
          /source\s*src\s*=\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
          /https?:\/\/[^"' \s]+\.(?:mp4|m3u8)[^"' \s]*/gi,
        ];
        const seenUrl = new Set<string>();
        for (const re of patterns) {
          let m: RegExpExecArray | null;
          re.lastIndex = 0;
          while ((m = re.exec(html)) !== null) {
            const raw = m[1] || m[0];
            const cleaned = raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
            if (!cleaned || seenUrl.has(cleaned) || cleaned.startsWith("blob:")) continue;
            seenUrl.add(cleaned);
            try {
              const abs = new URL(cleaned, url).toString();
              const ext = abs.split(".").pop()?.split("?")[0]?.toLowerCase() || "mp4";
              if (["mp4", "webm", "mov", "m3u8"].includes(ext)) {
                detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
                if (detected.length >= 3) break;
              }
            } catch {}
          }
          if (detected.length) break;
        }
        if (detected.length) console.log(`[cheerio] regex found ${detected.length} for ${jobId} (attempt ${attempt + 1})`);
      }
      if (detected.length) console.log(`[cheerio] found ${detected.length} for ${jobId} (attempt ${attempt + 1})`);
      break;
    } catch (e: any) {
      const isTimeout = e?.name === "TimeoutError" || String(e).includes("TimeoutError") || String(e).includes("aborted");
      console.warn(`[cheerio] ${isTimeout ? "timeout" : "failed"} ${jobId} attempt ${attempt + 1}`, String(e).slice(0, 180));
      if (isTimeout && attempt === 0) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      break;
    }
  }
  return { detected, pageTitle };
}
