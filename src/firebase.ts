import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Use environment variable for API key if available to avoid hardcoding secrets
const config = {
  ...firebaseConfig,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey
};

const app = initializeApp(config);
export const db = getFirestore(app, config.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth();
export const googleProvider = new GoogleAuthProvider();

getRedirectResult(auth).then((result) => {
    if (result) {
        console.log("Successfully logged in via redirect");
    }
}).catch((error) => {
    console.error("Error carefully checking redirect result:", error);
    if (error?.code === 'auth/unauthorized-domain') {
        alert("This domain is not authorized for Firebase Auth. Please add it in the Firebase Console Settings -> Authentication -> Authorized domains.");
    }
});

export const signInWithGoogle = async () => {
    try {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
            // Mobile devices often block popups or have issues with third-party cookie access in popups.
            await signInWithRedirect(auth, googleProvider);
        } else {
            await signInWithPopup(auth, googleProvider);
        }
    } catch (error: any) {
        if (error?.code === 'auth/popup-closed-by-user') {
            console.log("Sign in popup was closed by the user.");
            return;
        }
        if (error?.code === 'auth/unauthorized-domain') {
            alert("This domain is not authorized for Firebase Auth. Please add it in the Firebase Console Settings -> Authentication -> Authorized domains.");
            return;
        }
        
        // If it's a cross-origin iframe issue, fallback to redirect or prompt user
        if (error?.message?.includes('Cross-Origin') || error?.name === 'FirebaseError') {
             alert('Authentication failed. If you are viewing this in the AI Studio preview, please click the "Open in new tab" icon (top right) to sign in safely.');
        } else {
             alert("Sign-in error: " + error.message);
        }
        
        console.error("Error signing in with Google", error);
        throw error;
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
        
        // Clear cached browser data
        localStorage.clear();
        sessionStorage.clear();
        
        // Clear Firestore local database
        try {
            await terminate(db);
            await clearIndexedDbPersistence(db);
        } catch (e) {
            console.warn("Could not clear firestore persistence", e);
        }
        
        // Reload to completely wipe in-memory state and re-initialize Firebase
        window.location.reload();
    } catch (error) {
        console.error("Error signing out", error);
        throw error;
    }
};

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
