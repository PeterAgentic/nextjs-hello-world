import { useState } from 'react';
import { useRouter } from 'next/router';

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const router = useRouter();

  const handleHost = () => {
    const code = generateRoomCode();
    router.push(`/chat?room=${code}`);
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (joinCode.trim()) {
      router.push(`/chat?room=${joinCode.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="text-3xl font-bold mb-8">Rush Roulette</h1>
      <div className="flex flex-col space-y-6 w-full max-w-xs">
        <button
          onClick={handleHost}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded shadow"
        >
          Host a Game
        </button>
        <form onSubmit={handleJoin} className="flex flex-col space-y-2">
          <input
            type="text"
            placeholder="Enter Room Code"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            className="rounded px-3 py-2 bg-white text-gray-900 border border-gray-400 shadow focus:outline-none placeholder-gray-600"
            maxLength={8}
          />
          <button
            type="submit"
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded shadow"
          >
            Join a Game
          </button>
        </form>
      </div>
    </div>
  );
}
