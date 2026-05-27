import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const databaseId = (firebaseConfig as any).firestoreDatabaseId || (firebaseConfig as any).databaseId;
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
export const auth = getAuth();
const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => auth.signOut();

// Validation connection on boot
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

// User Profile Service
export const saveUserProfile = async (uid: string, data: any) => {
  try {
    await setDoc(doc(db, 'users', uid), {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error("Error saving user profile:", e);
  }
};

export const getUserProfile = async (uid: string) => {
  const d = await getDoc(doc(db, 'users', uid));
  return d.exists() ? d.data() : null;
};

// Cue Points Service
export const saveCuePoint = async (uid: string, trackId: string, position: number) => {
  try {
    await addDoc(collection(db, 'users', uid, 'cuePoints'), {
      trackId,
      position,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error("Error saving cue point:", e);
  }
};

// Song Requests Service
export const submitSongRequest = async (title: string, artist: string, uid: string) => {
  try {
    await addDoc(collection(db, 'songRequests'), {
      title,
      artist,
      requestedBy: uid,
      requestedAt: serverTimestamp(),
      status: 'pending'
    });
  } catch (e) {
    console.error("Error submitting song request:", e);
  }
};
