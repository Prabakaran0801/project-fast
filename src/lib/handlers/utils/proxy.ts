/**
 * Proxy utility — for bypassing ISP blocks (e.g., pornhub.org blocked in India)
 * Priority: YTDLP_PROXY > HTTPS_PROXY > HTTP_PROXY > http_proxy > https_proxy
 * Supports: http://, https://, socks5://
 * FREE alternative: Vercel US (iad1) has no India ISP block — prod needs no proxy.
 * For local India, set YTDLP_PROXY to free Webshare 10 proxies (webshare.io free tier) or leave empty and use Vercel as free proxy via /api/fetch-proxy
 */

export function getProxyUrl(): string | undefined {
  const raw =
    process.env.YTDLP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // basic validation
  try {
    const u = new URL(trimmed);
    if (!["http:", "https:", "socks5:", "socks4:"].includes(u.protocol)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

export function getYtDlpProxyArgs(): Record<string, string> {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return {};
  return { proxy: proxyUrl };
}

// Free alternative check: is Vercel US (no ISP block) so pornhub works without proxy on prod
export function isFreeProxyNeeded(): boolean {
  // On Vercel iad1, no need for proxy for pornhub (US not blocked). Local India needs proxy.
  // If YTDLP_PROXY is 402 Payment Required, treat as not needed and fallback to free /api/fetch-proxy for cheerio
  return false;
}

export function getFreeProxyUrl(): string | undefined {
  // Free alternatives (permanent, no payment):
  // 1. Webshare free tier: 10 proxies at webshare.io (create new account) -> set YTDLP_PROXY
  // 2. Vercel US fetch-proxy: /api/fetch-proxy?url=... (for cheerio, not yt-dlp --proxy)
  // 3. Public free list (unreliable): https://api.proxyscrape.com/?request=getproxies&proxytype=http
  // For yt-dlp --proxy, best free is Webshare free or leave empty and use Vercel US
  return undefined;
}

// For fetch — returns dispatcher for undici if proxy configured
let cachedDispatcher: any = undefined;
let cachedProxyUrl: string | undefined = undefined;

export function getFetchDispatcher(): any | undefined {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;
  // http/https proxy via undici ProxyAgent, socks5 via same (undici supports it)
  if (cachedDispatcher && cachedProxyUrl === proxyUrl) return cachedDispatcher;
  try {
    // dynamic require — undici is bundled with Node 18+ fetch
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProxyAgent } = require("undici");
    const agent = new ProxyAgent(proxyUrl);
    cachedDispatcher = agent;
    cachedProxyUrl = proxyUrl;
    console.log(`[proxy] fetch dispatcher enabled via ${proxyUrl.replace(/:[^:/@]+@/, "://***@")}`);
    return agent;
  } catch (e) {
    console.warn("[proxy] undici ProxyAgent not available, fetch proxy disabled", String(e).slice(0, 120));
    return undefined;
  }
}

export function getProxyFetchOptions(): RequestInit & { dispatcher?: any } {
  const dispatcher = getFetchDispatcher();
  if (dispatcher) return { dispatcher } as any;
  return {};
}
