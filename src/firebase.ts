import { initializeApp } from 'firebase/app';
import { getAuth, signOut as fbSignOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, initializeFirestore, memoryLocalCache, setLogLevel } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true
}, (firebaseConfig as any).firestoreDatabaseId);

// Suppress verbose internal Firebase SDK warnings (e.g. temporary connection drops, offline mode warnings)
setLogLevel('silent');

export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType?: OperationType, path?: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType: operationType || OperationType.GET,
    path: path || null
  };
  console.warn('Firestore Operation Notice:', errInfo);
  return errInfo;
}

// Validate connection on boot as requested in skill
async function testConnection() {
  try {
    let isExceeded = false;
    let exceededTimeStr: string | null = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        isExceeded = window.localStorage.getItem('firestore_quota_exceeded') === 'true';
        exceededTimeStr = window.localStorage.getItem('firestore_quota_exceeded_time');
      }
    } catch (e) {
      console.warn("localStorage access not available in testConnection:", e);
    }

    if (isExceeded) {
      if (exceededTimeStr) {
        const exceededTime = parseInt(exceededTimeStr, 10);
        // If 12 hours have passed, clear the flag to try again
        if (new Date().getTime() - exceededTime > 12 * 60 * 60 * 1000) {
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem('firestore_quota_exceeded');
              window.localStorage.removeItem('firestore_quota_exceeded_time');
            }
          } catch (e) {}
          console.log("Firestore quota lockout expired. Retrying connection...");
        } else {
          console.log("Firestore connection test skipped: Quota is marked as exceeded.");
          return;
        }
      } else {
        console.log("Firestore connection test skipped: Quota is marked as exceeded.");
        return;
      }
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection check timed out - offline mode active')), 2500)
    );

    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      timeoutPromise
    ]);
    console.log("Firestore backend connection verified successfully.");
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('limit exceeded')) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('firestore_quota_exceeded', 'true');
            window.localStorage.setItem('firestore_quota_exceeded_time', new Date().getTime().toString());
          }
        } catch (e) {}
        console.log("Firestore connection test: Quota limit exceeded. Operating in local mode.");
        return;
      }
      if (msg.includes('offline') || msg.includes('timed out') || msg.includes('could not reach') || msg.includes('backend')) {
        console.log("Firestore connection test: Backend unreachable or offline. Operating smoothly in local storage mode.");
        return;
      }
      if (msg.includes('invalid-api-key') || msg.includes('invalid-project-id')) {
        console.error("Please check your Firebase configuration:", error.message);
      }
    }
  }
}
// Delay testConnection so it doesn't block offline startup
setTimeout(testConnection, 3000);
