'use client';

import { useRef, useState, useCallback } from 'react';
import s from './WinampPlayer.module.css';

interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  genre: string;
  playCount?: number;
}

interface Props {
  tracks: Track[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EQ_BARS: Array<{
  dur: string;
  min: string;
  max: string;
  height: string;
}> = [
  { dur: '0.3s', min: '2px', max: '28px', height: '10px' },
  { dur: '0.5s', min: '4px', max: '36px', height: '20px' },
  { dur: '0.4s', min: '2px', max: '32px', height: '14px' },
  { dur: '0.6s', min: '6px', max: '38px', height: '30px' },
  { dur: '0.35s', min: '3px', max: '26px', height: '8px' },
  { dur: '0.45s', min: '5px', max: '34px', height: '22px' },
  { dur: '0.55s', min: '2px', max: '30px', height: '12px' },
  { dur: '0.38s', min: '4px', max: '20px', height: '6px' },
];

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function WinampPlayer({ tracks }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const registerPlayAbortRef = useRef<AbortController | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(tracks.map((t) => [t.id, t.playCount ?? 0])),
  );

  const currentTrack = tracks[currentIndex];
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayDuration =
    duration > 0 ? duration : (currentTrack?.duration ?? 0);

  const registerPlay = useCallback(async (trackId: string) => {
    registerPlayAbortRef.current?.abort();
    registerPlayAbortRef.current = new AbortController();
    try {
      await fetch(`${API_URL}/events/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
        signal: registerPlayAbortRef.current.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }, []);

  const play = useCallback(
    async (audio: HTMLAudioElement, index: number) => {
      if (!audio.src || audio.src === window.location.href) {
        audio.src = `${API_URL}/stream/${tracks[index].id}`;
      }
      const p = audio.play();
      playPromiseRef.current = p;
      try {
        await p;
        if (playPromiseRef.current === p) {
          setIsPlaying(true);
          setPlayCounts((prev) => ({
            ...prev,
            [tracks[index].id]: (prev[tracks[index].id] ?? 0) + 1,
          }));
          registerPlay(tracks[index].id);
        }
      } catch {
        setIsPlaying(false);
      }
    },
    [tracks, registerPlay],
  );

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      play(audio, currentIndex);
    }
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  }

  function selectTrack(index: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const wasPlaying = isPlaying;
    audio.pause();
    audio.src = `${API_URL}/stream/${tracks[index].id}`;
    audio.currentTime = 0;
    setCurrentIndex(index);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPct(0);
    setIsPlaying(false);
    if (wasPlaying) {
      play(audio, index);
    }
  }

  function next() {
    selectTrack((currentIndex + 1) % tracks.length);
  }

  function prev() {
    selectTrack((currentIndex - 1 + tracks.length) % tracks.length);
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);
  }

  function handleProgress() {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    if (audio.buffered.length > 0) {
      setBufferedPct(
        (audio.buffered.end(audio.buffered.length - 1) / audio.duration) * 100,
      );
    }
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (audio) {
      setDuration(audio.duration);
      audio.volume = volume;
    }
  }

  function handleEnded() {
    next();
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const newTime = (Number(e.target.value) / 100) * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value) / 100;
    setVolume(val);
    const audio = audioRef.current;
    if (audio) audio.volume = val;
  }

  if (tracks.length === 0) {
    return (
      <div className={s.page}>
        <div className={s.winamp}>
          <div className={s.titleBar}>
            <span className={s.titleBarText}>STREAMINGDEMO v1.0</span>
          </div>
          <div className={s.mainPanel}>
            <p className={s.offline}>
              BACKEND OFFLINE{'\n'}INICIE streaming-api NA PORTA 3001
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onProgress={handleProgress}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPause={() => setIsPlaying(false)}
      />

      <div className={s.winamp}>
        {/* Title bar */}
        <div className={s.titleBar}>
          <span className={s.titleBarText}>STREAMINGDEMO v1.0</span>
          <div className={s.titleBarButtons}>
            <button className={s.tbBtn} aria-label="Minimizar">
              _
            </button>
            <button className={s.tbBtn} aria-label="Maximizar">
              □
            </button>
            <button className={s.tbBtn} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>

        {/* Main panel */}
        <div className={s.mainPanel}>
          {/* Display LED */}
          <div className={s.display}>
            <div className={s.displayInfo}>
              <div className={s.trackName}>
                {currentTrack
                  ? `${currentTrack.title.toUpperCase()} — ${currentTrack.artist.toUpperCase()}`
                  : 'SEM FAIXAS'}
              </div>
              <div className={s.timeDisplay}>
                {fmt(currentTime)} / {fmt(displayDuration)}
              </div>
              <div className={s.bitrate}>128KBPS • 44KHZ • STEREO</div>
            </div>
            <div className={s.eq}>
              {EQ_BARS.map((bar, i) => (
                <div
                  key={i}
                  className={`${s.eqBar}${isPlaying ? ` ${s.eqBarPlaying}` : ''}`}
                  style={
                    {
                      height: bar.height,
                      '--dur': bar.dur,
                      '--min': bar.min,
                      '--max': bar.max,
                    } as React.CSSProperties & Record<string, string>
                  }
                />
              ))}
            </div>
          </div>

          {/* Progress */}
          <div className={s.progressWrap}>
            <input
              type="range"
              className={s.progressBar}
              value={progressPct}
              min={0}
              max={100}
              step={0.1}
              onChange={handleSeek}
              aria-label="Progresso da faixa"
              style={
                {
                  '--pct': `${progressPct}%`,
                  '--buf': `${bufferedPct}%`,
                } as React.CSSProperties & Record<string, string>
              }
            />
          </div>

          {/* Controls */}
          <div className={s.controls}>
            <button
              className={s.btn}
              onClick={prev}
              aria-label="Anterior"
              title="Anterior"
            >
              |◄
            </button>
            <button
              className={`${s.btn} ${s.playBtn}${isPlaying ? ` ${s.playBtnActive}` : ''}`}
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar' : 'Tocar'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              className={s.btn}
              onClick={stop}
              aria-label="Stop"
              title="Stop"
            >
              ■
            </button>
            <button
              className={s.btn}
              onClick={next}
              aria-label="Próxima"
              title="Próxima"
            >
              ►|
            </button>
            <div className={s.volumeWrap}>
              <span className={s.volLabel}>VOL</span>
              <input
                type="range"
                className={s.volumeBar}
                value={Math.round(volume * 100)}
                min={0}
                max={100}
                onChange={handleVolume}
                aria-label="Volume"
                style={
                  {
                    '--vol': `${Math.round(volume * 100)}%`,
                  } as React.CSSProperties & Record<string, string>
                }
              />
            </div>
          </div>
        </div>

        {/* Playlist */}
        <div className={s.playlistPanel}>
          <div className={s.playlistTitle}>
            <span>PLAYLIST</span>
            <span>
              {tracks.length} {tracks.length === 1 ? 'FAIXA' : 'FAIXAS'}
            </span>
          </div>
          <div className={s.playlistList}>
            {tracks.map((track, i) => (
              <div
                key={track.id}
                className={`${s.playlistItem}${i === currentIndex ? ` ${s.playlistItemActive}` : ''}`}
                onClick={() => selectTrack(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && selectTrack(i)}
                aria-label={`Tocar ${track.title} de ${track.artist}`}
                aria-current={i === currentIndex ? 'true' : undefined}
              >
                <span className={s.plIcon}>
                  {i === currentIndex && isPlaying ? '▶' : ' '}
                </span>
                <span className={s.plNum}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className={s.plInfo}>
                  <div className={s.plTitle}>{track.title.toUpperCase()}</div>
                  <div className={s.plArtist}>{track.artist}</div>
                </div>
                <div className={s.plDurWrap}>
                  <span className={s.plDur}>{fmt(track.duration)}</span>
                  <span className={s.plPlays}>
                    ▶ {playCounts[track.id] ?? 0}x
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
