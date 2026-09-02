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
  // proxy support: if YTDLP_PROXY / HTTPS_PROXY set, route fetch via ProxyAgent (for pornhub ISP block)
  let dispatcher: any = undefined;
  try {
    // lazy to avoid circular init
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFetchDispatcher } = require("./proxy");
    dispatcher = getFetchDispatcher();
  } catch {}
  const opts: any = { headers: cheerioHeadersFor(url), redirect: "follow", signal: AbortSignal.timeout(timeoutMs) };
  if (dispatcher) opts.dispatcher = dispatcher;
  return fetch(url, opts);
}
