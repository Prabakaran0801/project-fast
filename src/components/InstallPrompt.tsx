"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Download } from "lucide-react";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("speeddl:pwa-dismissed") === "1") return;
    const handler = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    // Also show in standalone check: if not installed and is mobile, hint after 3s
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone;
    if (!isStandalone) {
      const t = setTimeout(() => {
        // show hint even if beforeinstallprompt didn't fire (iOS)
        if (!deferred && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) setVisible(true);
      }, 3000);
      return () => { window.removeEventListener("beforeinstallprompt", handler); clearTimeout(t); };
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [deferred]);

  if (!visible || dismissed) return null;

  const onInstall = async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setVisible(false);
      setDeferred(null);
    } else {
      // iOS manual instruction
      setVisible(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50">
      <div className="rounded-2xl border border-zinc-800 bg-[#121214] p-4 shadow-xl flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-white text-zinc-900 grid place-items-center shrink-0">
          <Download className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">Install SpeedDL</p>
          <p className="text-xs font-mono text-zinc-400 mt-0.5">Add to home screen for offline history & faster launches.</p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={onInstall} className="rounded-full h-8 px-4 text-xs">
              {deferred ? "Install" : "How to install"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDismissed(true); localStorage.setItem("speeddl:pwa-dismissed", "1"); }} className="rounded-full h-8 px-3 text-xs">
              Not now
            </Button>
          </div>
          {!deferred && <p className="text-[11px] font-mono text-zinc-500 mt-2">iOS: Share → Add to Home Screen</p>}
        </div>
        <button onClick={() => { setDismissed(true); localStorage.setItem("speeddl:pwa-dismissed", "1"); }} aria-label="Dismiss" className="p-1 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
