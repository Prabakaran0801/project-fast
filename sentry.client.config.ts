import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || "",
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 0.1,
  replaysSessionSampleRate: 0.01,
  enabled: !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN),
  // Filter out noisy errors
  ignoreErrors: ["ResizeObserver", "bis_skin_checked"],
});
