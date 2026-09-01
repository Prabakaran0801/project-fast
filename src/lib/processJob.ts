import prisma from "@/lib/prisma";
import { isDirectVideoUrl, handleDirect } from "@/lib/handlers/direct";
import { routeHandlers, isYoutube } from "@/lib/handlers";
import { youtubeThumbnail } from "@/lib/handlers/utils/thumbnail";

export async function processSingleJob(jobId: string, url: string) {
  await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "PARSING", progress: 10 } });
  if (isDirectVideoUrl(url)) {
    const detectedDirect = handleDirect(url);
    const exp = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.downloadJob.update({ where: { id: jobId }, data: { detectedUrls: detectedDirect as any, status: "COMPLETED", progress: 100, expiresAt: exp } });
    return detectedDirect;
  }
  // delegate to per-site handlers (cheerio | ytDlpGeneric | youtube) – same logic website → same handler
  const { detected: routed, pageTitle } = await routeHandlers(url, jobId);
  let detected: any[] = routed;

  const youtube = isYoutube(url);
  const isFailed = detected.length === 0;
  if (isFailed) {
    const thumb = youtubeThumbnail(url, "");
    const errCode = youtube ? "youtube_blocked" : "blocked_or_unsupported";
    detected = [{ url, quality: "auto", ext: "mp4", thumbnail: thumb, hasAudio: false, needsMerge: false, title: pageTitle || "video", _failed: true, error: errCode } as any];
  }
  const seen = new Set<string>();
  detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));
  detected.forEach((d: any) => { if (!d.thumbnail) d.thumbnail = youtubeThumbnail(url, d.thumbnail); });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.downloadJob.update({
    where: { id: jobId },
    data: { detectedUrls: detected as any, status: isFailed ? "FAILED" : "COMPLETED", progress: 100, expiresAt },
  });
  if (isFailed) console.warn(`[processJob] ${jobId} failed - no formats isYoutube=${youtube} ${youtube ? "youtube needs cookies (YTDLP_COOKIES/cookies.txt)" : "missav/pornhub blocked or yt-dlp outdated"}`);
  return detected;
}
