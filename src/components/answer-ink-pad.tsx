"use client";

/**
 * AnswerInkPad — the "Write / photo" panel for the shared AnswerTextarea
 * (HUB-ANSWER-BOX wave 3; operator trace 1a0e9bee463b0451 "The answer box from
 * savemyexams has so many features" + the free/no-card constraint, trace
 * 1a0e9ca20ea0c671).
 *
 * SaveMyExams-parity input WITHOUT the contract change: the learner draws with
 * mouse/touch/pen on an ink canvas, or snaps a photo, and the core's
 * vision-capable chain member (already provisioned — no new vendor, no card)
 * transcribes it to PLAIN TEXT. The result lands in an editable preview FIRST:
 * the learner sees exactly what the AI read and can fix it before inserting at
 * the caret — transcription is a hint under human control, never a silent
 * rewrite of the answer.
 *
 * Honesty rules:
 *   - the image is transcription INPUT only — never stored, never sent to a
 *     mark lane, leaves no artifact (core contract comment);
 *   - the answer stays a plain-text contract end-to-end (the transcription
 *     policy on core forbids LaTeX/markdown output);
 *   - the panel hides itself when there is no learner session: transcription
 *     is an authenticated, per-learner rate-limited spend, and showing a
 *     button that 401s would be a dishonest affordance.
 *
 * Pen behaviour the operator asked about needs no vendor: the canvas region
 * handles PointerEvents with touch-action none, so a stylus draws here and
 * keeps acting as a mouse everywhere else — that is the platform default,
 * scoped by this one element.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Eraser, Loader2, PenLine, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, ApiError, getToken } from "@/lib/api";

/** Internal ink resolution — fixed so exports are deterministic regardless of
 *  the CSS box; 4:3 matches a phone photo crop well enough for handwriting. */
const INK_W = 1024;
const INK_H = 768;
/** Max dimension of anything sent to core (matches the server's 4 MB cap with
 *  plenty of headroom at JPEG quality 0.9). */
const MAX_IMAGE_DIM = 1600;

type Stroke = { points: { x: number; y: number }[] };

type PanelStatus = "drawing" | "converting" | "preview";

export function AnswerInkPad({
  onInsert,
  className,
}: {
  /** Called with the (possibly learner-edited) transcribed text; the parent
   *  inserts at the textarea caret and restores focus. */
  onInsert: (text: string) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoBlobRef = useRef<Blob | null>(null);

  const [hasInk, setHasInk] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [status, setStatus] = useState<PanelStatus>("drawing");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, INK_W, INK_H);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const stroke of strokesRef.current) {
      if (stroke.points.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
      // a tap should still make a visible dot
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
      ctx.stroke();
    }
  }, []);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * INK_W,
      y: ((e.clientY - rect.top) / rect.height) * INK_H,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (status !== "drawing") return;
    // any pointer type draws here (mouse, touch, pen) — the element owns it
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push({ points: [pointFromEvent(e)] });
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    strokesRef.current[strokesRef.current.length - 1]?.points.push(pointFromEvent(e));
    redraw();
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setHasInk(strokesRef.current.length > 0);
  };

  const undo = () => {
    strokesRef.current.pop();
    redraw();
    setHasInk(strokesRef.current.length > 0);
  };

  const clear = () => {
    strokesRef.current = [];
    photoBlobRef.current = null;
    redraw();
    setHasInk(false);
    setHasPhoto(false);
  };

  const exportInkPng = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    redraw(); // flush any unrendered stroke tail
    return canvas.toDataURL("image/png").split(",")[1] ?? null;
  };

  /** Downscale any photo to ≤MAX_IMAGE_DIM and return base64 JPEG. */
  const fileToJpegBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("could not read that file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("that file is not an image we can read"));
        img.onload = () => {
          const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const out = document.createElement("canvas");
          out.width = w;
          out.height = h;
          const ctx = out.getContext("2d");
          if (!ctx) return reject(new Error("could not process that image"));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(out.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "");
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setStatus("drawing"); // photo replaces ink at convert time, not before
    await convertPhoto(file);
  };

  const convertPhoto = async (file: File) => {
    setStatus("converting");
    setError(null);
    try {
      const base64 = await fileToJpegBase64(file);
      const result = await api.transcribeHandwriting(base64, "image/jpeg");
      setPreview(result.text);
      setStatus("preview");
    } catch (err) {
      setStatus("drawing");
      setError(transcriptionErrorMessage(err));
    }
  };

  const convertInk = async () => {
    if (photoBlobRef.current) {
      await convertPhoto(
        new File([photoBlobRef.current], "photo.jpg", { type: photoBlobRef.current.type }),
      );
      return;
    }
    const base64 = exportInkPng();
    if (!base64) {
      setError("nothing to convert yet — write something first");
      return;
    }
    setStatus("converting");
    setError(null);
    try {
      const result = await api.transcribeHandwriting(base64, "image/png");
      setPreview(result.text);
      setStatus("preview");
    } catch (err) {
      setStatus("drawing");
      setError(transcriptionErrorMessage(err));
    }
  };

  const insert = () => {
    const text = preview.trim();
    if (!text) return;
    onInsert(text);
    // reset for the next use — the answer now carries the text, the image is gone
    clear();
    setPreview("");
    setStatus("drawing");
    setError(null);
  };

  return (
    <div
      className={cn(
        "mt-1 rounded-lg border bg-muted/30 p-3",
        className,
      )}
      role="group"
      aria-label="Write or photograph your answer"
    >
      <canvas
        ref={canvasRef}
        width={INK_W}
        height={INK_H}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
        // the pad owns the pointer: touch/pen draw instead of scrolling here
        style={{ touchAction: "none" }}
        className="block aspect-[4/3] w-full cursor-crosshair rounded-md border bg-white"
        aria-label="Handwriting area — draw with your finger, stylus, or mouse"
      />

      {status === "drawing" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={convertInk}
            disabled={!hasInk && !hasPhoto}
            className="h-8 gap-1.5 text-[12px]"
          >
            <PenLine className="size-3.5" aria-hidden />
            Convert to text
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={undo}
            disabled={!hasInk}
            className="h-8 gap-1.5 text-[12px] text-muted-foreground"
          >
            <Undo2 className="size-3.5" aria-hidden /> undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clear}
            disabled={!hasInk && !hasPhoto}
            className="h-8 gap-1.5 text-[12px] text-muted-foreground"
          >
            <Eraser className="size-3.5" aria-hidden /> clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 gap-1.5 text-[12px] text-muted-foreground"
          >
            <Camera className="size-3.5" aria-hidden /> use a photo
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPhotoPicked}
            className="hidden"
            aria-label="Upload a photo of your handwritten answer"
          />
        </div>
      )}

      {status === "converting" && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> reading your writing…
        </p>
      )}

      {status === "preview" && (
        <div className="mt-2">
          <label
            htmlFor="answer-ink-preview"
            className="text-[11px] font-medium text-muted-foreground"
          >
            We read your writing as — check and fix it before inserting:
          </label>
          <Textarea
            id="answer-ink-preview"
            value={preview}
            onChange={(e) => setPreview(e.target.value)}
            rows={3}
            className="mt-1 min-h-16 bg-background text-[13px]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={insert}
              disabled={!preview.trim()}
              className="h-8 text-[12px]"
            >
              Insert into answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatus("drawing");
                setError(null);
              }}
              className="h-8 text-[12px] text-muted-foreground"
            >
              Back to drawing
            </Button>
          </div>
        </div>
      )}

      {status === "drawing" && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Write text or equations and we&apos;ll convert it to text — check the result before it
          goes into your answer. The image itself is never stored.
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-[11px] leading-snug text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Error mapping mirrors the core contract: fixed, honest, actionable. */
function transcriptionErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return "your session expired — sign in again to use handwriting";
      case 413:
        return "that image is too large — the pad and photo upload downscale automatically, so this usually means a stale tab";
      case 422:
        return "we couldn't read any handwriting in that image — write a little larger and try again";
      case 503:
        return "transcription is temporarily unavailable — try again in a moment";
      default:
        return "that didn't work — please try again";
    }
  }
  return "that didn't work — please try again";
}

/** Session gate: the pad is an authenticated, per-learner spend. */
export function useHasLearnerSession(): boolean {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    const sync = () => setAuthed(Boolean(getToken()));
    sync();
    window.addEventListener("syllabai:session-expired", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("syllabai:session-expired", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return authed;
}
