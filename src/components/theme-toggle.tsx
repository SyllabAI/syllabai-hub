"use client";

/**
 * ThemeToggle — dual-theme switcher (SME | Quiet Green × Light | Dark |
 * System). Two mount shapes:
 *   variant="icon" (default) — compact header dropdown
 *   variant="row"            — labelled pill for the footer
 *
 * State lives in src/lib/theme-store.ts (localStorage-backed, no-flash
 * bootstrap applied server-side before paint). The first mount calls
 * hydrateTheme() so the React store agrees with what the bootstrap applied.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MODE_LABEL,
  THEME_LABEL,
  getServerThemeState,
  getThemeState,
  hydrateTheme,
  setTheme,
  subscribeTheme,
  type ThemeMode,
  type ThemeName,
} from "@/lib/theme-store";

const THEMES: ThemeName[] = ["sme", "quiet-green"];
const MODES: ThemeMode[] = ["light", "dark", "system"];

function Row({
  active,
  children,
  onSelect,
}: {
  active: boolean;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="cursor-pointer justify-between"
      aria-checked={active}
      role="menuitemradio"
      data-state={active ? "checked" : "unchecked"}
    >
      <span className="flex items-center gap-2">{children}</span>
      <Check className={cn("size-4", active ? "opacity-100" : "opacity-0")} aria-hidden />
    </DropdownMenuItem>
  );
}

export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const state = useSyncExternalStore(subscribeTheme, getThemeState, getServerThemeState);

  useEffect(() => {
    hydrateTheme();
  }, []);

  const trigger =
    variant === "icon" ? (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Theme: ${THEME_LABEL[state.theme]}, appearance: ${MODE_LABEL[state.mode]} — open theme menu`}
        className="size-10"
      >
        <Palette className="size-4" aria-hidden />
      </Button>
    ) : (
      <Button variant="outline" size="sm" className="gap-1.5 text-[11px] font-normal">
        <Palette className="size-3.5" aria-hidden />
        {THEME_LABEL[state.theme]} · {MODE_LABEL[state.mode]}
      </Button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {THEMES.map((t) => (
          <Row
            key={t}
            active={state.theme === t}
            onSelect={() => setTheme({ theme: t })}
          >
            <span className="font-medium">{THEME_LABEL[t]}</span>
          </Row>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {MODES.map((m) => (
          <Row
            key={m}
            active={state.mode === m}
            onSelect={() => setTheme({ mode: m })}
          >
            {m === "light" && <Sun className="size-4 text-muted-foreground" aria-hidden />}
            {m === "dark" && <Moon className="size-4 text-muted-foreground" aria-hidden />}
            {m === "system" && <Monitor className="size-4 text-muted-foreground" aria-hidden />}
            <span className="font-medium">{MODE_LABEL[m]}</span>
          </Row>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
