// Router: same logic website → same handler, different requirement → different handler
// Preserves execution order: direct → cheerio → ytDlpGeneric / youtube
import { isDirectVideoUrl, handleDirect } from "./direct";
import { cheerioCrawl } from "./cheerio";
import { ytDlpGeneric } from "./ytDlpGeneric";
import { youtubeHandler } from "./youtube";

export function isYoutube(url: string) { return /youtube\.com|youtu\.be/.test(url); }
export function isSocial(url: string) { return /twitter\.com|x\.com|instagram\.com|tiktok\.com/.test(url); }
export function isGenericVideoSite(url: string) {
  return /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|vimeo\.com|twitch\.tv|fpo\.xxx|wowxxx|pornhub|xvideos|xhamster|redtube|youjizz|missav/.test(url);
}

export async function routeHandlers(url: string, jobId: string) {
  // 1. direct mp4
  if (isDirectVideoUrl(url)) return { detected: handleDirect(url), pageTitle: "" };
  // 2. cheerio (generic)
  const { detected: cheerioDetected, pageTitle } = await cheerioCrawl(url, jobId);
  let detected = cheerioDetected;
  const youtube = isYoutube(url);
  const needsYtdlp = detected.length === 0 || isGenericVideoSite(url);
  if (needsYtdlp) {
    const preferYtdlpOverCheerio = isSocial(url);
    if (!youtube && (detected.length === 0 || preferYtdlpOverCheerio)) {
      const generic = await ytDlpGeneric(url, jobId);
      if (generic && generic.length) detected = generic;
      else if (preferYtdlpOverCheerio && !generic) console.warn(`[router] ytDlpGeneric no formats for ${url.slice(0,60)} - keeping cheerio`);
    }
    if (youtube || detected.length === 0) {
      const yt = await youtubeHandler(url, jobId, detected);
      if (yt.length) detected = yt;
    }
  }
  return { detected, pageTitle };
}
