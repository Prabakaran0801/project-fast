"use client";
import { useCallback, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, File as FileIcon, X, Link2, Copy, Check, Mail, Send, AlertCircle } from "lucide-react";

export function TransferDropzone() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [emailResults, setEmailResults] = useState<any[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [message, setMessage] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  function addEmail() {
    const trimmed = emailInput.trim().toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmed) { setEmailError("Enter recipient email"); return; }
    if (!emailRe.test(trimmed)) { setEmailError("Invalid email"); return; }
    if (fromEmail && trimmed === fromEmail.trim().toLowerCase()) { setEmailError("Sender and recipient must be different"); return; }
    if (emails.includes(trimmed)) { setEmailError("Already added"); return; }
    if (emails.length >= 5) { setEmailError("Max 5 recipients"); return; }
    setEmails([...emails, trimmed]);
    setEmailInput("");
    setEmailError(null);
  }

  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadedBytes, setUploadedBytes] = useState<number>(0);

  function formatMB(bytes: number) {
    return (bytes / 1024 / 1024).toFixed(2);
  }

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  function uploadWithProgress(url: string, file: File, onProgress: (loaded: number, total: number) => void, signal?: { cancelled: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (signal?.cancelled) return reject(new Error("Upload cancelled"));
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 upload failed for ${file.name}: ${xhr.status} ${xhr.responseText?.slice(0, 200)}`));
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        if (signal?.cancelled) return reject(new Error("Upload cancelled"));
        reject(new Error(`Network error uploading ${file.name} — check R2 CORS allows PUT from ${window.location.origin}`));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error("Upload cancelled"));
      };
      xhr.send(file);
    });
  }

  function handleCancel() {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setUploading(false);
    setUploadProgress(0);
    setUploadedBytes(0);
    setError("Upload cancelled");
    console.log("[transfer] cancelled by user");
  }

  const hasValidRecipient = emails.length > 0;
  const hasValidSender = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail);
  const canTransfer = hasValidRecipient && hasValidSender && files.length > 0;
  const isSameEmail = hasValidRecipient && hasValidSender && emails.some((e) => e.toLowerCase() === fromEmail.trim().toLowerCase());

  async function handleUpload() {
    if (!files.length) { setError("Add files to transfer"); return; }
    if (!hasValidRecipient) { setError("Email to is required — add at least one recipient"); return; }
    if (!hasValidSender) { setError("Your email is required"); return; }
    if (isSameEmail) { setError("Sender and recipient must be different"); return; }
    setUploading(true);
    setUploadProgress(0);
    setUploadedBytes(0);
    setError(null);
    try {
      // 1. Create transfer + get presigned PUTs (direct browser → R2)
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
          emails,
          message: message || undefined,
          fromEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      // 2. Upload each file directly to R2 via presigned POST with MB-accurate progress
      const uploadUrls: any[] = data.uploadUrls || [];
      const totalBytes = files.reduce((a, f) => a + f.size, 0);
      if (uploadUrls.length && uploadUrls[0]?.uploadUrl) {
        console.log(`[transfer] uploading ${files.length} files (${formatMB(totalBytes)} MB) directly to R2 via presigned POST`);
        let completedBytes = 0;
        for (let idx = 0; idx < files.length; idx++) {
          const file = files[idx];
          const target = uploadUrls.find((u: any) => u.filename === file.name) || uploadUrls[idx];
          if (!target?.uploadUrl) {
            console.warn(`[transfer] no presigned for ${file.name}, skipping R2 upload`);
            completedBytes += file.size;
            continue;
          }
          const fileStartBytes = completedBytes;
          const cancelSignal = { cancelled: false };
          // allow cancel to set flag
          if ((handleCancel as any)._signal) (handleCancel as any)._signal.cancelled = true;
          (handleCancel as any)._signal = cancelSignal;
          await uploadWithProgress(target.uploadUrl, file, (loaded, total) => {
            if (cancelSignal.cancelled) return;
            const overallLoaded = fileStartBytes + loaded;
            const pct = Math.round((overallLoaded / totalBytes) * 100);
            setUploadProgress(pct);
            setUploadedBytes(overallLoaded);
          }, cancelSignal);
          completedBytes += file.size;
          setUploadedBytes(completedBytes);
          console.log(`[transfer] uploaded ${file.name} ${formatMB(file.size)} MB ${idx + 1}/${files.length}`);
        }
        setUploadProgress(100);
        setUploadedBytes(totalBytes);
      } else {
        console.log("[transfer] S3 not configured or presigned missing — DB mock only, no R2 bytes");
      }

      setShareUrl(data.transferUrl || `${window.location.origin}/d/mock123`);
      setEmailResults(data.emailResults || null);
      console.log(`[transfer] done — shareUrl ${data.transferUrl}, emails:`, data.emailResults);
    } catch (e) {
      console.error("[transfer] upload error", e);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const totalSize = files.reduce((a, f) => a + f.size, 0);

  if (shareUrl) {
    return (
      <Card className="p-6 sm:p-8 text-center bg-[#121214] border-zinc-800 rounded-2xl shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-500 text-white grid place-items-center mb-4">
          <Link2 className="h-6 w-6" />
        </div>
        <h3 className="font-semibold text-[15px] text-white">Transfer ready</h3>
        <p className="text-sm text-zinc-400 font-mono mt-1">Expires in 4 days — share this link</p>
        <div className="mt-4 flex items-center gap-2 max-w-md mx-auto">
          <code className="flex-1 text-sm font-mono bg-zinc-900 border border-zinc-700 text-white rounded-xl px-3 py-2.5 truncate text-left">
            {shareUrl}
          </code>
          <Button size="icon" variant="outline" className="rounded-xl shrink-0" onClick={async () => { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        {emailResults && emailResults.length > 0 && (
          <div className="mt-4 text-xs font-mono text-left max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white">
            <div className="flex items-center gap-1.5 font-medium mb-1"><Mail className="h-3.5 w-3.5" /> Email delivery</div>
            {emailResults.map((r: any) => (
              <div key={r.to} className="flex justify-between">
                <span className="truncate">{r.to}</span>
                <span className={r.status === "sent" ? "text-emerald-400" : r.status === "skipped" ? "text-zinc-500" : "text-red-400"}>{r.status}</span>
              </div>
            ))}
            {emailResults.some((r: any) => r.status === "skipped") && <p className="text-[11px] text-zinc-500 mt-2">SMTP not configured — set SMTP_* in .env to enable real emails. Link still works.</p>}
          </div>
        )}
        <Button variant="ghost" className="mt-4 rounded-full" onClick={() => { setFiles([]); setShareUrl(null); setEmails([]); setEmailResults(null); }}>
          Send another
        </Button>
      </Card>
    );
  }

  return (
    <Card
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`p-6 sm:p-8 border-2 border-dashed rounded-2xl transition-all ${dragOver ? "border-white bg-zinc-900 scale-[1.01]" : "border-zinc-800 bg-[#121214]"}`}
    >
      <div className="text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-white text-zinc-900 grid place-items-center mb-3 shadow-sm">
          <UploadCloud className="h-6 w-6" />
        </div>
        <h3 className="font-semibold text-[14px] text-white">Drop files here</h3>
        <p className="text-sm text-zinc-400 mt-1 font-mono">or click to browse — up to 5GB, resumable via TUS</p>
        <label className="mt-4 inline-block">
          <input type="file" multiple className="hidden" onChange={onFileChange} />
          <span className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-white text-zinc-900 text-sm font-medium cursor-pointer hover:bg-zinc-200 shadow-sm">
            Browse files
          </span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-900 text-sm">
                <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />
                <span className="flex-1 truncate font-mono text-xs text-white">{f.name}</span>
                <span className="text-xs text-zinc-400 font-mono">{formatMB(f.size)} MB</span>
                {!uploading && (
                  <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <div className="text-xs font-mono text-zinc-500 text-right">{files.length} files · {formatMB(totalSize)} MB</div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
            <label className="text-xs font-mono tracking-[0.08em] text-zinc-400">Email to *</label>
            <div className="flex gap-2">
              <Input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }} placeholder="recipient@email.com" className="flex-1 h-9 rounded-xl font-mono text-sm" />
              <Button type="button" variant="outline" onClick={addEmail} className="rounded-xl h-9">Add</Button>
            </div>
            {emailError && <p className="text-xs text-red-400 font-mono flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {emailError}</p>}
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {emails.map((em) => (
                  <span key={em} className="inline-flex items-center gap-1.5 text-xs font-mono bg-zinc-800 border border-zinc-700 text-white rounded-full px-2.5 py-1">
                    {em} <button onClick={() => setEmails(emails.filter((e) => e !== em))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <label className="text-xs font-mono tracking-[0.08em] text-zinc-400">Your email *</label>
            <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="your@email.com" className="h-9 rounded-xl font-mono text-sm" />
            {isSameEmail && <p className="text-xs text-red-400 font-mono flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Sender and recipient must be different</p>}
            <label className="text-xs font-mono tracking-[0.08em] text-zinc-400">Message (optional)</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message — optional" rows={2} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white font-sans" />
          </div>

          {error && <p className="text-sm text-red-400 font-mono flex items-center gap-1 bg-red-950/30 border border-red-900 rounded-xl px-3 py-2"><AlertCircle className="h-4 w-4" /> {error}</p>}
          {isSameEmail && !error && <p className="text-sm text-red-400 font-mono flex items-center gap-1 bg-red-950/30 border border-red-900 rounded-xl px-3 py-2"><AlertCircle className="h-4 w-4" /> Sender and recipient must be different</p>}
          {uploading && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-zinc-400">Uploading...</span>
                <span className="text-white">{formatMB(uploadedBytes)} / {formatMB(totalSize)} MB • {uploadProgress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { if (uploading) handleCancel(); else { setFiles([]); setEmails([]); setEmailError(null); setError(null); setUploadProgress(0); setUploadedBytes(0); } }} className="flex-1 rounded-full h-11 gap-2">
              {uploading ? "Cancel upload" : "Cancel"}
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !canTransfer || isSameEmail} className="flex-1 rounded-full h-11 gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {uploading ? `${uploadProgress}%` : <><Send className="h-4 w-4" /> Transfer</>}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
