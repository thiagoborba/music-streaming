import { AudioPlayer } from '@/components/AudioPlayer';

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default async function HomePage() {
  const tracks = await getTracks();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">StreamingDemo</h1>
        <p className="text-sm text-zinc-400">
          NestJS + Next.js • Range Streaming • Redis Cache • BullMQ
        </p>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-3">
        {tracks.length === 0 ? (
          <p className="text-zinc-500 text-sm">
            Backend offline ou sem faixas. Inicie{' '}
            <code className="bg-zinc-800 px-1 rounded">streaming-api</code> na
            porta 3001.
          </p>
        ) : (
          tracks.map((track) => (
            <div
              key={track.id}
              className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{track.title}</p>
                  <p className="text-sm text-zinc-400">
                    {track.artist} • {track.genre}
                  </p>
                </div>
                <span className="text-xs text-zinc-500">
                  {formatDuration(track.duration)}
                </span>
              </div>
              <AudioPlayer trackId={track.id} trackTitle={track.title} />
            </div>
          ))
        )}
      </main>
    </div>
  );
}
