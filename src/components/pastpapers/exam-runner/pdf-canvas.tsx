/**
 * PdfCanvas — minimal fit-width pdf.js page renderer for the Paper Run.
 *
 * A deliberately small sibling of pdf-pane.tsx: the run needs a bare page
 * with a stable box to overlay answer rects onto (page-fraction UI
 * metadata), not the full viewer chrome. Same worker setup as pdf-pane
 * (/pdfjs/pdf.worker.min.mjs, public/).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface PdfCanvasProps {
  url: string;
  pageNo: number;
  className?: string;
}

export function PdfCanvas({ url, pageNo, className }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const taskRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [boxW, setBoxW] = useState(0);

  // load document once
  useEffect(() => {
    let cancelled = false;
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = pdfjs.getDocument({ url });
        const doc = await task.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy().catch(() => undefined);
      docRef.current?.destroy().catch(() => undefined);
      docRef.current = null;
    };
  }, [url]);

  // container width tracking (fit-width rendering)
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setBoxW(Math.max(0, Math.floor(w)));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // render the current page whenever page/size changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas || boxW <= 0) return;
      const clamped = Math.min(Math.max(1, pageNo), doc.numPages);
      const page = await doc.getPage(clamped);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = (boxW / base.width) * dpr;
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${boxW}px`;
      canvas.style.height = `${Math.floor(boxW * (base.height / base.width))}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      taskRef.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport: vp });
      taskRef.current = task;
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNo, boxW, numPages]);

  if (failed) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        This PDF could not be loaded. Check your connection and retry.
      </div>
    );
  }

  const clamped = Math.min(Math.max(1, pageNo), Math.max(1, numPages));

  return (
    <div ref={boxRef} className={className}>
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading PDF…
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`block rounded-lg border shadow-sm ${loading ? "hidden" : ""}`}
        data-page={clamped}
      />
    </div>
  );
}
