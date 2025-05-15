import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import app, { db } from '../firebase';

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [userPoints, setUserPoints] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (!firebaseUser) {
        router.replace('/signup');
      } else {
        // Fetch user points from Firestore
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUserPoints(userDoc.data().points || 0);
        } else {
          setUserPoints(0);
        }
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
      {/* Menu Card with Integrated Profile Section */}
      <div className="relative rounded-3xl p-10 w-full max-w-md flex flex-col items-center shadow-2xl" style={{ boxShadow: '0 0 40px 10px #ff2d55, 0 0 0 4px #222 inset' }}>
        {/* Integrated Profile Section */}
        {user && (
          <div className="w-full flex items-center gap-4 mb-6 pb-4 border-b-2 border-[#ff2d55]">
            <div className="bg-[#222] rounded-full p-2 flex items-center justify-center shadow-[0_0_8px_2px_#ff2d55]">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 7.5a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.5a7.5 7.5 0 1115 0v.75a.75.75 0 01-.75.75h-13.5a.75.75 0 01-.75-.75v-.75z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-white text-lg leading-tight">{user.displayName || user.email}</span>
              <span className="text-pink-400 font-mono text-base">Points: {userPoints !== null ? userPoints : '...'}</span>
            </div>
          </div>
        )}
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
