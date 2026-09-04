import prisma from "@/lib/prisma";
import { isDirectVideoUrl, handleDirect } from "@/lib/handlers/direct";
import { routeHandlers, isYoutube } from "@/lib/handlers";
import { youtubeThumbnail } from "@/lib/handlers/utils/thumbnail";

export async function processSingleJob(jobId: string, url: string) {
  console.log(`[processJob] start ${jobId} ${url.slice(0, 80)} platform=${process.platform}`);

  try {
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "PARSING", progress: 10 } });
  } catch (e: any) {
    console.error(`[processJob] DB update PARSING failed for ${jobId}: ${String(e?.message || e).slice(0, 300)}`);
    throw e;
  }

  if (isDirectVideoUrl(url)) {
    const detectedDirect = handleDirect(url);
    const exp = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.downloadJob.update({
      where: { id: jobId },
      data: { detectedUrls: detectedDirect as any, status: "COMPLETED", progress: 100, expiresAt: exp },
    });
    return detectedDirect;
  }

  // Hobby: single client attempt only — sequential default/android/tv retries
  // cannot fit inside the 10s function budget. Pick ONE client (android tends
  // to be fastest + least likely to hit the bot check) and commit to it.
  const isHobby = process.env.VERCEL === "1";
  const routeTimeoutMs = isHobby ? 8000 : 30000; // leave 2s buffer for DB write on Hobby

  let routed: any[] = [];
  let pageTitle = "";
  try {
    const res: any = await Promise.race([
      routeHandlers(url, jobId),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`routeHandlers timeout ${routeTimeoutMs}ms`)), routeTimeoutMs)),
    ]);
    routed = res.detected;
    pageTitle = res.pageTitle;
  } catch (e: any) {
    console.warn(`[processJob] routeHandlers timeout/error for ${jobId}: ${String(e?.message || e).slice(0, 200)}`);
    routed = [];
    pageTitle = "";
  }

  let detected: any[] = routed;
  const youtube = isYoutube(url);
  const isFailed = detected.length === 0;

  if (isFailed) {
    const thumb = youtubeThumbnail(url, "");
    const errCode = youtube ? "youtube_blocked" : "blocked_or_unsupported";
    detected = [{
      url, quality: "auto", ext: "mp4", thumbnail: thumb, hasAudio: false,
      needsMerge: false, title: pageTitle || "video", _failed: true, error: errCode,
    } as any];
  }

  const seen = new Set<string>();
  detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));
  detected.forEach((d: any) => { if (!d.thumbnail) d.thumbnail = youtubeThumbnail(url, d.thumbnail); });

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.downloadJob.update({
    where: { id: jobId },
    data: { detectedUrls: detected as any, status: isFailed ? "FAILED" : "COMPLETED", progress: 100, expiresAt },
  });

  if (isFailed) {
    console.warn(`[processJob] ${jobId} failed - no formats isYoutube=${youtube} ${youtube ? "youtube needs cookies (YTDLP_COOKIES/cookies.txt)" : "missav/pornhub blocked or yt-dlp outdated"}`);
  }

  return detected;
}
