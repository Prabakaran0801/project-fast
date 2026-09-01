export function youtubeThumbnail(url: string, fallback: string) {
  const m = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
  return fallback;
}
