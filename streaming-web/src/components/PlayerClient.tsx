'use client';

import dynamic from 'next/dynamic';

interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  genre: string;
  playCount?: number;
}

const WinampPlayer = dynamic(
  () => import('./WinampPlayer').then((m) => ({ default: m.WinampPlayer })),
  { ssr: false, loading: () => null },
);

export function PlayerClient({ tracks }: { tracks: Track[] }) {
  return <WinampPlayer tracks={tracks} />;
}
