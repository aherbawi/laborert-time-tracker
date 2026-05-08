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

/**
 * Detects if third-party cookies or storage might be blocked.
 * This is a common cause for Firebase Auth failures in iframes or mobile browsers.
 */
export const checkStorageAccess = async (): Promise<boolean> => {
    try {
        // Try to access localStorage - will throw if blocked in some contexts
        localStorage.setItem('test_storage', 'test');
        localStorage.removeItem('test_storage');
        
        // If we are in an iframe, we check for storage access API if available
        if (window.self !== window.top && 'hasStorageAccess' in document) {
            return await (document as any).hasStorageAccess();
        }
        
        return true;
    } catch (e) {
        console.warn("Storage access appears to be restricted:", e);
        return false;
    }
};

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
    console.log("signInWithGoogle called");
    try {
        // First check storage access
        const storageOk = await checkStorageAccess();
        console.log("Storage access check:", storageOk);
        
        // Try popup first
        console.log("Attempting signInWithPopup...");
        try {
            const result = await signInWithPopup(auth, googleProvider);
            console.log("signInWithPopup success:", result.user.email);
        } catch (popupError: any) {
            console.warn("signInWithPopup failed:", popupError.code, popupError.message);
            
            // If popup is blocked or fails, then try redirect as a fallback
            if (popupError?.code === 'auth/popup-blocked' || 
                popupError?.code === 'auth/cancelled-popup-request' ||
                popupError?.code === 'auth/internal-error' ||
                popupError?.message?.includes('closed by user')) {
                console.log("Falling back to signInWithRedirect...");
                try {
                    await signInWithRedirect(auth, googleProvider);
                } catch (redirectError: any) {
                    console.error("signInWithRedirect failed:", redirectError);
                    alert("Sign-in failed. Please try opening the app in a new tab using the icon at the top right.");
                    throw redirectError;
                }
            } else {
                if (popupError?.code === 'auth/unauthorized-domain') {
                    alert("Unauthorized domain. This usually means the current preview URL needs to be added to Firebase Console -> Authentication -> Settings -> Authorized Domains. Current URL: " + window.location.hostname);
                } else {
                    alert("Sign-in error: " + (popupError?.message || popupError));
                }
                throw popupError;
            }
        }
    } catch (error: any) {
        console.error("Final sign-in error", error);
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
