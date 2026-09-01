export function cheerioHeadersFor(url: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: (() => {
      try { return new URL(url).origin + "/"; } catch { return "https://www.fpo.xxx/"; }
    })(),
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

export function fetchHtml(url: string, timeoutMs = 15000) {
  return fetch(url, { headers: cheerioHeadersFor(url), redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
}
