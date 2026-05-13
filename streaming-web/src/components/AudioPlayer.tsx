'use client';

import { useRef, useState } from 'react';

interface Props {
  trackId: string;
  trackTitle: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function AudioPlayer({ trackId, trackTitle }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  async function registerPlay() {
    try {
      await fetch(`${API_URL}/events/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
    } catch {
      // não bloqueia o player se o event falhar
    }
  }

  function handlePlay() {
    setPlaying(true);
    registerPlay();
  }

  function handlePause() {
    setPlaying(false);
  }

  function handleError() {
    setError(true);
    setPlaying(false);
  }

  return (
    <div className="space-y-1">
      <audio
        ref={audioRef}
        src={`${API_URL}/stream/${trackId}`}
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleError}
        controls
        className="w-full h-9"
        aria-label={`Player: ${trackTitle}`}
      />
      {error && (
        <p className="text-xs text-red-400">
          Arquivo de áudio não encontrado. Adicione <code className="bg-zinc-800 px-1 rounded">{trackId}.mp3</code> em <code className="bg-zinc-800 px-1 rounded">streaming-api/audio/</code>.
        </p>
      )}
      {playing && <p className="text-xs text-emerald-400">Transmitindo via HTTP 206 Partial Content</p>}
    </div>
  );
}
