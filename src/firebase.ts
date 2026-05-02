import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
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
        }
        console.error("Error signing in with Google", error);
        throw error;
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
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
