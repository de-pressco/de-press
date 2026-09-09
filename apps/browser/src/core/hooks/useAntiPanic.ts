import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readAntiPanic, writeAntiPanic } from "@/core/antiPanic";
import { killAllSockets } from "@/core/ws/registry";
import {
  endOpenPanicEpisodes,
  startPanicEpisode,
} from "@/core/memory/db";

interface AntiPanicValue {
  active: boolean;
  enter: () => void;
  exit: () => void;
}

const AntiPanicContext = createContext<AntiPanicValue | null>(null);

function pauseMedia(): void {
  document.querySelectorAll("audio, video").forEach((el) => {
    const media = el as HTMLMediaElement;
    try {
      media.pause();
    } catch {
      /* ignore */
    }
  });
}

export function AntiPanicProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(readAntiPanic);

  useEffect(() => {
    document.body.classList.toggle("antiPanicActive", active);
  }, [active]);

  const enter = useCallback(() => {
    killAllSockets();
    pauseMedia();
    writeAntiPanic(true);
    setActive(true);
    // Local episode marker (ADR-0025): timestamps only, never uploaded.
    void startPanicEpisode(new Date().toISOString()).catch(() => undefined);
  }, []);

  const exit = useCallback(() => {
    writeAntiPanic(false);
    setActive(false);
    void endOpenPanicEpisodes(new Date().toISOString()).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ active, enter, exit }),
    [active, enter, exit],
  );

  return createElement(AntiPanicContext.Provider, { value }, children);
}

export function useAntiPanic(): AntiPanicValue {
  const ctx = useContext(AntiPanicContext);
  if (!ctx) {
    throw new Error("useAntiPanic must be used inside AntiPanicProvider");
  }
  return ctx;
}
