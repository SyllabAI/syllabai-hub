"use client";

/**
 * Composer — the tutor's input deck.
 *
 * Typical chatbot ergonomics: auto-growing textarea (Enter sends,
 * Shift+Enter breaks a line), live character budget, an attach affordance
 * that is honest about file support, push-to-talk dictation via the Web
 * Speech API when the browser offers it, and a send/stop pair that mirrors
 * the stream state. The 600→2000 character budget is enforced server-side
 * (api/ai/chat zod) and mirrored here.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Paperclip, Send, Square } from "lucide-react";

/** Server body cap for `question` (api/ai/chat zod schema). */
export const QUESTION_CAP = 2000;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export function Composer({
  value,
  onChange,
  busy,
  maxLen,
  placeholder,
  onSend,
  onStop,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  maxLen: number;
  placeholder: string;
  onSend: () => void;
  onStop: () => void;
}) {
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  // Web Speech dictation — feature-detected, hydration-safe (server says no,
  // the client snapshot re-evaluates after mount; button hides where absent)
  const speechAvailable = useSyncExternalStore(
    () => () => {},
    () => {
      const w = window as unknown as Record<string, unknown>;
      return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    },
    () => false,
  );

  // auto-grow up to a screen-friendly ceiling
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  // stop any live dictation session when the composer unmounts
  useEffect(() => () => recRef.current?.stop(), []);

  const toggleDictation = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.interimResults = false;
    rec.continuous = true;
    const base = value ? `${value.trimEnd()} ` : "";
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0]?.transcript ?? "";
      onChange(`${base}${said.trim()}`.slice(0, maxLen));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const nearCap = value.length > maxLen - 120;

  return (
    <div className="rounded-xl border bg-card shadow-xs focus-within:border-primary/40">
      <div className="flex items-end gap-1.5 p-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 text-muted-foreground"
          aria-label="Attach a file"
          onClick={() =>
            toast({
              title: "File upload isn’t available yet",
              description: "The tutor grounds its answers in the corpus for now — paste the relevant text into your question.",
            })
          }
        >
          <Paperclip className="size-4" aria-hidden />
        </Button>
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          maxLength={maxLen}
          rows={1}
          placeholder={placeholder}
          aria-label="Message the tutor"
          className="max-h-42 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
        />
        {speechAvailable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("size-10 shrink-0", listening ? "text-destructive" : "text-muted-foreground")}
            aria-label={listening ? "Stop dictation" : "Dictate your question"}
            aria-pressed={listening}
            onClick={toggleDictation}
          >
            {listening ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
          </Button>
        )}
        {busy ? (
          <Button variant="outline" onClick={onStop} className="h-10 shrink-0 gap-1.5 px-3">
            <Square className="size-3.5 fill-current" aria-hidden /> Stop
          </Button>
        ) : (
          <Button onClick={onSend} disabled={!value.trim()} className="h-10 shrink-0 gap-1.5 px-3">
            <Send className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Send</span>
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between border-t px-3 py-1 text-[10px] text-muted-foreground">
        <span>
          <kbd className="rounded border bg-muted px-1 py-px font-mono">Enter</kbd> to send ·{" "}
          <kbd className="rounded border bg-muted px-1 py-px font-mono">Shift</kbd>+
          <kbd className="rounded border bg-muted px-1 py-px font-mono">Enter</kbd> for a new line
        </span>
        {nearCap && (
          <span className="tabular-nums" aria-live="polite">
            {value.length}/{maxLen}
          </span>
        )}
      </div>
    </div>
  );
}
