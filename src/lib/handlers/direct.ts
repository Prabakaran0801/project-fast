import { youtubeThumbnail } from "./utils/thumbnail";

export function isDirectVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

export function handleDirect(url: string) {
  const thumb = youtubeThumbnail(url, "");
  return [{ url, quality: "auto", height: undefined, ext: url.split(".").pop()!.split("?")[0].toLowerCase(), thumbnail: thumb, hasAudio: true, needsMerge: false, title: url.split("/").pop()!.slice(0, 40) || "video" }];
}
