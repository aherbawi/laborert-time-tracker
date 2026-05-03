import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth();

// Explicitly set persistence to LOCAL for better mobile reliability
setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error("Failed to set persistence:", err);
});

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
        // Try popup first as it is more reliable for state persistence on mobile Chrome 
        // if the user has popups enabled or handles the "Popup blocked" prompt.
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (popupError: any) {
            // If popup is blocked or fails, then try redirect as a fallback
            if (popupError?.code === 'auth/popup-blocked' || popupError?.code === 'auth/cancelled-popup-request') {
                console.log("Popup blocked, falling back to redirect...");
                await signInWithRedirect(auth, googleProvider);
            } else {
                throw popupError;
            }
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
        
        // Detailed error for typical iframe/mobile issues
        const isIframe = window.self !== window.top;
        if (isIframe || error?.message?.includes('Cross-Origin')) {
             alert('Authentication failed. If you are using a mobile device or a restricted browser, please click the "Open in new tab" icon (top right) or ensure third-party cookies are allowed.');
        } else {
             alert("Sign-in error: " + error.code + " - " + error.message);
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
