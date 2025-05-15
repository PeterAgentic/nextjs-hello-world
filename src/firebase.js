import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// import { getAnalytics } from "firebase/analytics"; // Not needed for auth, and can cause issues in SSR

const firebaseConfig = {
  apiKey: "AIzaSyCoC2VDndSlS6g3BD7aprOivGhiDABOAqk",
  authDomain: "rush-roulette-f297c.firebaseapp.com",
  projectId: "rush-roulette-f297c",
  storageBucket: "rush-roulette-f297c.appspot.com",
  messagingSenderId: "451594216005",
  appId: "1:451594216005:web:815f43293e8efe4b16392c",
  measurementId: "G-X17GGEGT4G"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// Only initialize analytics in the browser
// let analytics;
// if (typeof window !== 'undefined') {
//   analytics = getAnalytics(app);
// }

export default app;
export { db }; 