import { WinampPlayer } from '@/components/WinampPlayer';

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
    const res = await fetch(`${apiUrl}/tracks`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const tracks = await getTracks();
  return <WinampPlayer tracks={tracks} />;
}
