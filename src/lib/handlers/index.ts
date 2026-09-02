// Router — isolated handlers: youtube/instagram frozen, universal separately
// youtube -> youtubeHandler (FROZEN, web→android multi-client)
// instagram -> ytDlpGeneric with cleaned URL (FROZEN)
// all else (X/TikTok/pornhub/missav/fpo/vimeo...) -> universalHandler (cheerio -> ytDlpUniversal)
import { isDirectVideoUrl, handleDirect } from "./direct";
import { cheerioCrawl } from "./cheerio";
import { ytDlpGeneric } from "./ytDlpGeneric";
import { youtubeHandler } from "./youtube";
import { universalHandler } from "./universal";

export function isYoutube(url: string) { return /youtube\.com|youtu\.be/.test(url); }
export function isInstagram(url: string) { return /instagram\.com/.test(url); }
export function isSocial(url: string) { return /twitter\.com|x\.com|instagram\.com|tiktok\.com/.test(url); }
export function isGenericVideoSite(url: string) {
  return /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|vimeo\.com|twitch\.tv|fpo\.xxx|wowxxx|pornhub|xvideos|xhamster|redtube|youjizz|missav/.test(url);
}

export async function routeHandlers(url: string, jobId: string) {
  // 1. direct mp4
  if (isDirectVideoUrl(url)) return { detected: handleDirect(url), pageTitle: "" };

  // 2. FROZEN: YouTube — delegate directly to youtubeHandler (keeps web free 144p-2160p + piped + ytdl-core)
  if (isYoutube(url)) {
    const yt = await youtubeHandler(url, jobId, []);
    // youtubeHandler does its own multi-client search, returns best
    if (yt.length) return { detected: yt, pageTitle: "" };
    // fallback: if yt failed, try generic cheerio before returning empty (keeps old behavior without touching youtube.ts)
    const { detected: cheerioDetected, pageTitle } = await cheerioCrawl(url, jobId);
    if (cheerioDetected.length) return { detected: cheerioDetected, pageTitle };
    return { detected: [], pageTitle };
  }

  // 3. FROZEN: Instagram — cheerio + ytDlpGeneric (cleaned URL retry, 429 retry)
  if (isInstagram(url)) {
    const { detected: cheerioDetected, pageTitle } = await cheerioCrawl(url, jobId);
    let detected = cheerioDetected;
    const generic = await ytDlpGeneric(url, jobId);
    if (generic && generic.length) detected = generic;
    else if (!generic) console.warn(`[router] instagram ytDlpGeneric no formats for ${url.slice(0, 60)} - keeping cheerio ${detected.length}`);
    return { detected, pageTitle };
  }

  // 4. Universal — X, TikTok, pornhub, missav, fpo.xxx, wowxxx, vimeo, twitch, etc.
  // Isolated: cheerio generic -> ytDlpUniversal (no per-site logic)
  const { detected, pageTitle } = await universalHandler(url, jobId);
  return { detected, pageTitle };
}
