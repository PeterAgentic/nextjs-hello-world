import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import app from '../firebase';

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (!firebaseUser) {
        router.replace('/signup');
      }
    });
    return () => unsubscribe();
  }, [router]);

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

  if (loading) return null;
  if (!user) return null; // Will redirect to /signup

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111118]">
      <div className="rounded-3xl p-10 w-full max-w-md flex flex-col items-center shadow-2xl" style={{ boxShadow: '0 0 40px 10px #ff2d55, 0 0 0 4px #222 inset' }}>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-8 text-center text-[#ff2d55]" style={{ textShadow: '0 0 16px #ff2d55, 0 0 32px #ff2d55' }}>
          Rush Roulette
        </h1>
        <div className="flex flex-col space-y-6 w-full">
          <button
            onClick={handleHost}
            className="bg-[#ff2d55] hover:bg-[#ff4d75] text-white font-semibold py-3 px-4 rounded-lg shadow transition-all duration-200 text-lg focus:outline-none focus:ring-2 focus:ring-[#ff2d55] focus:ring-offset-2"
          >
            Host a Game
          </button>
          <button
            onClick={() => router.push('/chat?room=PUBLIC')}
            className="bg-yellow-500 hover:bg-yellow-600 text-white font-semibold py-3 px-4 rounded-lg shadow transition-all duration-200 text-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2"
          >
            Join Public Game
          </button>
          <form onSubmit={handleJoin} className="flex flex-col space-y-2">
            <input
              type="text"
              placeholder="Enter Room Code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              className="rounded-lg px-4 py-3 bg-[#222] text-gray-200 border-2 border-[#ff2d55] focus:border-[#ff2d55] focus:ring-2 focus:ring-[#ff2d55] placeholder-gray-400 text-lg shadow"
              maxLength={8}
            />
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg shadow transition-all duration-200 text-lg focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
            >
              Join a Game
            </button>
          </form>
        </div>
        <p className="mt-8 text-gray-300 text-center text-base">
          Race against other players to find items in your home!<br />
          Be the fastest to locate objects and climb the leaderboard.
        </p>
      </div>
    </div>
  );
}
