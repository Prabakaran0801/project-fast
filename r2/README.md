# R2 Lifecycle — apply to Cloudflare bucket `mediamover` (or `project-speed`)

## Web UI
R2 -> bucket `mediamover` -> Settings -> Object Lifecycle -> Add rule

- `merged/*` -> Expire after **1 day** (DB keeps 30min, R2 keep 1d safety)
- `transfers/*` -> Expire after **4 days** (matches DB `expiresAt = 4d`)
- Abort multipart after 1-2 days

## Wrangler CLI
```bash
npx wrangler r2 bucket lifecycle put mediamover --rules r2/lifecycle.json
# verify
npx wrangler r2 bucket lifecycle get mediamover
```

## Vercel Cron (DB cleanup)
`vercel.json` cron `0 */6 * * *` hits `POST /api/cleanup` every 6h:
- deletes expired `merged/` R2 keys + marks `DownloadJob.status=EXPIRED`
- transfers rely on R2 lifecycle (4d) + DB `expiresAt` check in `/d/[id]`

## Manual
```bash
curl -X POST https://your-domain.com/api/cleanup
```
