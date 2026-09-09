import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useI18n } from "@/core/i18n/context";
import styles from "./VoiceBubble.module.css";

interface VoiceBubbleProps {
  src: string;
  durationMs?: number | null;
  fromMe: boolean;
}

/** Volume prefs shared by all voice bubbles, persisted across sessions. */
const VOLUME_KEY = "dp.voice.volume";

interface VolumePrefs {
  volume: number;
  muted: boolean;
}

function loadVolume(): VolumePrefs {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VolumePrefs>;
      return {
        volume:
          typeof parsed.volume === "number"
            ? Math.min(1, Math.max(0, parsed.volume))
            : 1,
        muted: Boolean(parsed.muted),
      };
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return { volume: 1, muted: false };
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon
        points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
        fill="currentColor"
        stroke="none"
      />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      )}
    </svg>
  );
}

/**
 * TG-like compact voice player: play/pause, click-to-seek track,
 * elapsed / total time, and a volume panel (slider + mute) shared
 * across all bubbles and persisted in localStorage.
 */
export function VoiceBubble({ src, durationMs, fromMe }: VoiceBubbleProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uid = useId();
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(
    durationMs && durationMs > 0 ? durationMs : 0,
  );
  const [vol, setVol] = useState<VolumePrefs>(loadVolume);

  // Persist volume and apply it to the element on every change.
  useEffect(() => {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(vol));
    } catch {
      /* storage unavailable */
    }
    const el = audioRef.current;
    if (el) {
      el.volume = vol.volume;
      el.muted = vol.muted;
    }
  }, [vol]);

  // Only one voice note plays at a time (TG behavior).
  useEffect(() => {
    const onOtherPlay = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== uid) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("dp-voice-play", onOtherPlay);
    return () => window.removeEventListener("dp-voice-play", onOtherPlay);
  }, [uid]);


  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setElapsed(el.currentTime * 1000);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration * 1000);
      }
    };
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    window.dispatchEvent(new CustomEvent("dp-voice-play", { detail: uid }));
    try {
      await el.play();
      setPlaying(true);
    } catch {
      /* play() can reject when src is gone; stay paused */
    }
  }

  function seek(e: MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = (ratio * duration) / 1000;
    setElapsed(el.currentTime * 1000);
  }

  function seekKey(e: KeyboardEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
    if (!step) return;
    e.preventDefault();
    const nextMs = Math.min(duration, Math.max(0, el.currentTime * 1000 + step * 1000));
    el.currentTime = nextMs / 1000;
    setElapsed(nextMs);
  }

  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return (
    <div className={`${styles.wrap} ${fromMe ? styles.me : styles.them}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className={styles.play}
        onClick={() => void toggle()}
        aria-label={playing ? t.chat.playerPause : t.chat.playerPlay}
      >
        {playing ? (
          <span className={styles.pauseMark} aria-hidden />
        ) : (
          <span className={styles.playMark} aria-hidden />
        )}
      </button>
      <div className={styles.middle}>
        <div
          className={styles.trackHit}
          onClick={seek}
          onKeyDown={seekKey}
          role="slider"
          tabIndex={0}
          aria-label={t.chat.playerSeek}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.round(elapsed / 1000)}
        >
          <div className={styles.track}>
            <div
              className={styles.bar}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <span className={styles.time}>
          {formatClock(elapsed)}
          {duration > 0 ? ` / ${formatClock(duration)}` : ""}
        </span>
      </div>
      <div className={styles.volPanel}>
        <button
          type="button"
          className={styles.muteBtn}
          onClick={() => setVol((v) => ({ ...v, muted: !v.muted }))}
          aria-label={vol.muted ? t.chat.playerUnmute : t.chat.playerMute}
          aria-pressed={vol.muted}
        >
          <SpeakerIcon muted={vol.muted} />
        </button>
        <input
          type="range"
          className={styles.volRange}
          min={0}
          max={1}
          step={0.05}
          value={vol.muted ? 0 : vol.volume}
          onChange={(e) =>
            setVol({ volume: Number(e.target.value), muted: false })
          }
          aria-label={t.chat.playerVolume}
        />
      </div>
    </div>
  );
}
