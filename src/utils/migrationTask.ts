import { trackApiCall } from './apiTracker';
import { doc, getDoc, updateDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { BiomarkerLog, UserProfile } from '../types';

export const runCleanupMigration = async (uid: string, email?: string) => {
  // TEMPORARILY DISABLED (see AI_HANDOVER.md): this migration incorrectly
  // treats 'wbc' and 'creatinine' as legacy duplicate keys and deletes them,
  // but they are the current canonical biomarker keys in biomarkers.ts.
  // Do not re-enable until the deletion list is corrected and reviewed.
  return;
  const norm = uid;
  const migrationKey = `migration_july05_cleanup_done_${uid}`;
  if (localStorage.getItem(migrationKey) === 'true') {
    return;
  }
  
  try {
    console.log("Checking migration status in Firestore for UID:", uid);
    
    // 1. Check LocalStorage (done above)
    // 2. Secondary check in Firestore under UID
    const migrationRef = doc(db, 'users', uid, 'metadata', 'migration');
    trackApiCall('firebase_read', 'Firestore Read - Migration Check: Fetch July 5th cleanup metadata (checks if database schema migration is already applied)');
      const migrationSnap = await getDoc(migrationRef);
    
    // Check old flag in profile as well for backwards compatibility
    const profileRef = doc(db, 'users', uid);
    trackApiCall('firebase_read', 'Firestore Read - Migration Check: Read User Profile (backwards compatibility check for july 5th migration)');
      const profileSnap = await getDoc(profileRef);

    let isAlreadyDone = false;
    if (migrationSnap.exists() && migrationSnap.data().biomarkersV1Completed === true) {
      isAlreadyDone = true;
      console.log("[Migration] Already completed (verified in Firestore metadata)");
    } else if (profileSnap.exists()) {
      const profileData = profileSnap.data() as any;
      if (profileData.migration_july05_cleanup_done === true) {
        isAlreadyDone = true;
        console.log("[Migration] Already completed (verified in Firestore profile)");
      }
    }

    if (isAlreadyDone) {
      localStorage.setItem(migrationKey, 'true');
      return;
    }

    console.log("Running cleanup migration for UID:", uid);
    
    // Clean history logs under UID
    const historyRef = collection(db, 'users', uid, 'biomarkerHistory');
    trackApiCall('firebase_read', 'Firestore Read - Migration Exec: Fetch biomarker history list (loads full logs to perform July 5th key duplicates cleanup)');
      const snapshot = await getDocs(historyRef);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as BiomarkerLog;
      let madeChanges = false;
      const newBiomarkers = { ...data.biomarkers };
      
      const toDelete = [
        { key: 'basophil_count', val: 1 },
        { key: 'platelet_distribution_width', val: 5 },
        { key: 'audit_c_total_score', val: 5.5 },
        { key: 'sodium', val: 85.5 },
        { key: 'hematocrit', val: 5 },
      ];
      
      for (const t of toDelete) {
        if (newBiomarkers[t.key] === t.val) {
          delete newBiomarkers[t.key];
          madeChanges = true;
        }
      }
      
      // Also delete duplicates trapped in the US template keys
      if ('hgb' in newBiomarkers) { delete newBiomarkers['hgb']; madeChanges = true; }
      if ('wbc' in newBiomarkers) { delete newBiomarkers['wbc']; madeChanges = true; }
      if ('creatinine' in newBiomarkers) { delete newBiomarkers['creatinine']; madeChanges = true; }

      if (madeChanges) {
        trackApiCall('firebase_write', 'Firestore Write - Migration Exec: Clean up biomarker duplicate data (overwrites single history document with cleaned key-value payload)');
      await updateDoc(docSnap.ref, { biomarkers: newBiomarkers });
        console.log("Cleaned doc", docSnap.id);
      }
    }
    
    // Clean custom biomarkers
    let profileChanges: any = {};
    if (profileSnap.exists()) {
      const profileData = profileSnap.data() as UserProfile;
      const custom = { ...(profileData.customBiomarkers || {}) };
      
      const keysToRemove = ['hgb', 'wbc', 'creatinine', 'basophil_count', 'platelet_distribution_width', 'audit_c_total_score'];
      let customChanged = false;
      for (const k of keysToRemove) {
        if (custom[k]) {
          delete custom[k];
          customChanged = true;
        }
      }
      
      if (customChanged) {
        profileChanges.customBiomarkers = custom;
      }
    }
    
    // Mark as done in Firestore metadata
    trackApiCall('firebase_write', 'Firestore Write - Migration Exec: Mark July 5th cleanup as completed in Cloud metadata');
      await setDoc(migrationRef, { biomarkersV1Completed: true }, { merge: true });
    
    // If profile changes exist, apply them
    if (Object.keys(profileChanges).length > 0) {
      trackApiCall('firebase_write', 'Firestore Write - Migration Exec: Remove profile custom biomarker list duplicates');
      await updateDoc(profileRef, profileChanges);
    }
    
    localStorage.setItem(migrationKey, 'true');
    console.log("Migration complete!");
    window.location.reload();
  } catch (error) {
    console.error("Migration failed:", error);
  }
};
