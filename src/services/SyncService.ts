import { FoodLog, BiomarkerLog } from '../types';
import { syncLogsWithTimeBuckets, fetchAllConsolidatedLogs } from '../utils/syncUtils';

export class SyncService {
  static async syncLogs(
    db: any, 
    uid: string, 
    localFoods: FoodLog[], 
    localBiomarkers: BiomarkerLog[], 
    onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void
  ) {
    await syncLogsWithTimeBuckets(db, uid, localFoods, localBiomarkers, {}, {}, onSyncComplete);
  }

  static async pullFromServer(
    db: any, 
    uid: string, 
    localFoods: FoodLog[], 
    localBiomarkers: BiomarkerLog[], 
    onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void
  ) {
    const { serverFoods, serverBiomarkers } = await fetchAllConsolidatedLogs(db, uid, {}, {});
    
    const finalFoods = [...localFoods.filter(f => f.sync_state !== 'synced')];
    serverFoods.forEach(sf => {
      if (!finalFoods.find(f => f.id === sf.id)) {
        finalFoods.push(sf);
      }
    });

    const finalBiomarkers = [...localBiomarkers.filter(b => b.sync_state !== 'synced')];
    serverBiomarkers.forEach(sb => {
      if (!finalBiomarkers.find(b => b.id === sb.id)) {
        finalBiomarkers.push(sb);
      }
    });

    onSyncComplete(finalFoods, finalBiomarkers);
  }
}


/* mergeFoodLogsDeduped */
