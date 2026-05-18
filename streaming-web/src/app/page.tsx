import { PlayerClient } from '@/components/PlayerClient';

interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  genre: string;
}

async function getTracks(): Promise<Track[]> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${apiUrl}/tracks`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const tracks = await getTracks();
  return <PlayerClient tracks={tracks} />;
}
