import { cheerioCrawl } from "./cheerio";
import { handleDirect } from "./direct";
import { ytDlpUniversal } from "./utils/ytDlpUniversal";

// Universal handler — isolated from youtube/instagram frozen logic
// Chain: cheerio (generic) -> ytDlpUniversal -> direct fallback
// Covers: X (twitter/x.com), TikTok, pornhub, missav, fpo.xxx, wowxxx, vimeo, twitch, etc.
export async function universalHandler(url: string, jobId: string): Promise<{ detected: any[]; pageTitle: string }> {
  // 1. try generic cheerio first (fast, no binary)
  const { detected: cheerioDetected, pageTitle } = await cheerioCrawl(url, jobId);
  let detected = cheerioDetected;

  // 2. yt-dlp universal — prefer over cheerio if cheerio empty or weak (auto quality)
  // For X/TikTok cheerio often gives bare 403 links, so always try yt-dlp
  const isWeak = detected.length === 0 || detected.every((d: any) => d.quality === "auto");
  const shouldTryYtDlp = detected.length === 0 || isWeak || /twitter\.com|x\.com|tiktok\.com/.test(url);

  if (shouldTryYtDlp) {
    const generic = await ytDlpUniversal(url, jobId);
    if (generic && generic.length) {
      // if yt-dlp found better formats, use them (more qualities, hasAudio correct)
      detected = generic;
    } else if (detected.length === 0) {
      console.warn(`[universal] ytDlpUniversal no formats for ${url.slice(0, 60)} job=${jobId} - keeping cheerio=${cheerioDetected.length}`);
    }
  }

  // 3. direct fallback already handled by router, but keep for isolated calls
  if (detected.length === 0) {
    // no formats found - caller will mark FAILED
    console.warn(`[universal] no formats for ${url.slice(0, 60)} job=${jobId}`);
  }

  return { detected, pageTitle };
}

// Helper to detect if URL should go universal (not youtube, not instagram)
export function isUniversalUrl(url: string): boolean {
  if (/youtube\.com|youtu\.be/.test(url)) return false;
  if (/instagram\.com/.test(url)) return false;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return false;
  return true;
}
