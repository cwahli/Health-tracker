import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { FoodLog, BiomarkerLog, UserProfile } from '../types';
import { t } from '../utils/i18n';
import { Archive, Download, Upload, AlertCircle, Check, Image as ImageIcon, FileSpreadsheet, RefreshCw } from 'lucide-react';

interface Props {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkerHistory: BiomarkerLog[];
  setFoodLogs: (f: FoodLog[]) => void;
  setBiomarkerHistory: (b: BiomarkerLog[]) => void;
  biomarkers?: any;
  actions?: any[];
  dailyBenefits?: any[];
  report?: any;
  onSaveAndSync?: (profile: any, foodLogs: any[], biomarkers: any, biomarkerHistory: any[], actions: any[], dailyBenefits: any[], report: any, specificUpdate?: any) => Promise<void>;
}

export default function BackupRestoreTab({ profile, foodLogs, biomarkerHistory, setFoodLogs, setBiomarkerHistory, biomarkers, actions, dailyBenefits, report, onSaveAndSync }: Props) {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');
  const [conflicts, setConflicts] = useState<{ foods: any[], bio: any[] }>({ foods: [], bio: [] });
  const [showConflicts, setShowConflicts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stagedFoods, setStagedFoods] = useState<(FoodLog & { similarTo?: any })[]>([]);
  const [stagedBio, setStagedBio] = useState<BiomarkerLog[]>([]);
  const [selectedFoods, setSelectedFoods] = useState<Set<string>>(new Set());
  const [selectedBio, setSelectedBio] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, {
    resolution: 'keep_existing' | 'keep_backup' | 'keep_both';
    editData: FoodLog;
  }>>({});

  const updateResolutionEdit = (stagedId: string, fields: Partial<FoodLog>) => {
    setResolutions(prev => {
      const current = prev[stagedId] || { resolution: 'keep_both', editData: stagedFoods.find(sf => sf.id === stagedId)! };
      return {
        ...prev,
        [stagedId]: {
          ...current,
          editData: {
            ...current.editData,
            ...fields
          }
        }
      };
    });
  };

  const handleSetResolution = (stagedId: string, resolution: 'keep_existing' | 'keep_backup' | 'keep_both', stagedItem?: any) => {
    const f = stagedItem || stagedFoods.find(sf => sf.id === stagedId);
    if (!f) return;
    
    let baseData = { ...f };
    if (resolution === 'keep_existing') {
      baseData = { ...f.similarTo };
    }
    
    setResolutions(prev => ({
      ...prev,
      [stagedId]: {
        resolution,
        editData: baseData
      }
    }));
  };

  // Function to serialize state into CSVs and images into a zip
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const zip = new JSZip();

      // Separate images from food logs for CSV
      const foodCsvData = foodLogs.map(log => {
        const row = { ...log } as any;
        delete row.imageUrl;
        delete row.imageUrls;
        
        // ensure objects are stringified for CSV
        if (row.nutrients) row.nutrients = JSON.stringify(row.nutrients);
        if (row.itemsBreakdown) row.itemsBreakdown = JSON.stringify(row.itemsBreakdown);
        if (row.scoutItems) row.scoutItems = JSON.stringify(row.scoutItems);
        return row;
      });

      const bioCsvData = biomarkerHistory.map(log => {
        const row = { ...log } as any;
        if (row.biomarkers) row.biomarkers = JSON.stringify(row.biomarkers);
        if (row.tests) row.tests = JSON.stringify(row.tests);
        return row;
      });

      // Add CSVs
      zip.file("foodLogs.csv", Papa.unparse(foodCsvData));
      zip.file("biomarkerHistory.csv", Papa.unparse(bioCsvData));

      // Add images
      const imgFolder = zip.folder("images");
      if (imgFolder) {
        foodLogs.forEach(log => {
          if (log.imageUrl) {
            const base64Data = log.imageUrl.split(',')[1];
            if (base64Data) {
               // Extract format
               const match = log.imageUrl.match(/data:image\/([a-zA-Z0-9]+);base64,/);
               const ext = match ? match[1] : 'jpg';
               imgFolder.file(`${log.id}_main.${ext}`, base64Data, { base64: true });
            }
          }
          if (log.imageUrls && log.imageUrls.length > 0) {
            log.imageUrls.forEach((url, i) => {
               const base64Data = url.split(',')[1];
               if (base64Data) {
                  const match = url.match(/data:image\/([a-zA-Z0-9]+);base64,/);
                  const ext = match ? match[1] : 'jpg';
                  imgFolder.file(`${log.id}_extra_${i}.${ext}`, base64Data, { base64: true });
               }
            });
          }
        });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const filename = `${profile.nickname || 'User'}_backup_${new Date().toISOString().slice(0,10)}.zip`;
      saveAs(content, filename);
    } catch (e) {
      console.error(e);
      alert(t(profile?.language, 'alertBackupCreate'));
    }
    setIsExporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus(t(profile?.language, 'backupStReading'));
    try {
      const zip = new JSZip();
      await zip.loadAsync(file);

      // Parse food logs
      setImportStatus(t(profile?.language, 'backupStFoods'));
      let importedFoods: any[] = [];
      const foodFile = zip.file("foodLogs.csv");
      if (foodFile) {
        const foodCsv = await foodFile.async('string');
        const parsed = Papa.parse(foodCsv, { header: true });
        importedFoods = parsed.data.filter((r: any) => r.id).map((row: any) => {
          if (row.updated_at) row.updated_at = parseInt(row.updated_at, 10);
          if (typeof row.nutrients === 'string') {
            try { row.nutrients = JSON.parse(row.nutrients); } catch(e){}
          }
          if (typeof row.itemsBreakdown === 'string') {
            try { row.itemsBreakdown = JSON.parse(row.itemsBreakdown); } catch(e){}
          }
          if (typeof row.scoutItems === 'string') {
            try { row.scoutItems = JSON.parse(row.scoutItems); } catch(e){}
          }
          return row;
        });
      }

      // Parse biomarkers
      setImportStatus(t(profile?.language, 'backupStBio'));
      let importedBio: any[] = [];
      const bioFile = zip.file("biomarkerHistory.csv");
      if (bioFile) {
        const bioCsv = await bioFile.async('string');
        const parsed = Papa.parse(bioCsv, { header: true });
        importedBio = parsed.data.filter((r: any) => r.id).map((row: any) => {
          if (row.updated_at) row.updated_at = parseInt(row.updated_at, 10);
          if (typeof row.biomarkers === 'string') {
             try { row.biomarkers = JSON.parse(row.biomarkers); } catch(e){}
          }
          if (typeof row.tests === 'string') {
             try { row.tests = JSON.parse(row.tests); } catch(e){}
          }
          return row;
        });
      }

      // Read images
      setImportStatus(t(profile?.language, 'backupStImages'));
      const imgFolder = zip.folder("images");
      if (imgFolder) {
        for (const log of importedFoods) {
          const mainImgRegex = new RegExp(`${log.id}_main\\.[a-zA-Z0-9]+$`);
          const mainImgFiles = zip.file(mainImgRegex);
          if (mainImgFiles.length > 0) {
             const base64 = await mainImgFiles[0].async('base64');
             const ext = mainImgFiles[0].name.split('.').pop();
             log.imageUrl = `data:image/${ext};base64,${base64}`;
          }

          const extraImgRegex = new RegExp(`${log.id}_extra_\\d+\\.[a-zA-Z0-9]+$`);
          const extraImgFiles = zip.file(extraImgRegex);
          if (extraImgFiles.length > 0) {
             log.imageUrls = [];
             for (const f of extraImgFiles) {
                const base64 = await f.async('base64');
                const ext = f.name.split('.').pop();
                log.imageUrls.push(`data:image/${ext};base64,${base64}`);
             }
          }
        }
      }

      setImportStatus(t(profile?.language, 'backupStConflicts'));
      
      const newFoods: FoodLog[] = [];
      const newBio: BiomarkerLog[] = [];
      
      const existingFoodMap = new Map(foodLogs.map(f => [f.id, f]));
      const existingBioMap = new Map(biomarkerHistory.map(b => [b.id, b]));
      
      const existingPhotoMap = new Map();
      foodLogs.forEach(f => {
        if (f.imageUrl && f.imageUrl.length > 100) {
          existingPhotoMap.set(f.imageUrl, f);
        }
      });

      const zipPhotoMap = new Map();
      const nextResolutions: Record<string, {
        resolution: 'keep_existing' | 'keep_backup' | 'keep_both';
        editData: FoodLog;
      }> = {};

      importedFoods.forEach(f => {
         const existing = existingFoodMap.get(f.id);
         let existingByPhoto = f.imageUrl ? existingPhotoMap.get(f.imageUrl) : null;
         let similarSource: 'existing' | 'backup' = 'existing';
         
         if (!existingByPhoto && f.imageUrl && f.imageUrl.length > 100) {
           if (zipPhotoMap.has(f.imageUrl)) {
             existingByPhoto = zipPhotoMap.get(f.imageUrl);
             similarSource = 'backup';
           }
         }
         
         if (!existing) {
             if (existingByPhoto) {
                 (f as any).sync_state = 'similar_photo';
                 (f as any).similarTo = existingByPhoto;
                 (f as any).similarSource = similarSource;
                 nextResolutions[f.id] = {
                   resolution: 'keep_both',
                   editData: { ...f }
                 };
             } else {
                 f.sync_state = 'new';
             }
             f.updated_at = Date.now();
             newFoods.push(f);
         } else {
             // Deep comparison to see if anything changed
             const cloneF = { ...f };
             const cloneE = { ...existing };
             delete cloneF.updated_at;
             delete cloneE.updated_at;
             delete cloneF.imageUrl;
             delete cloneE.imageUrl;
             delete cloneF.imageUrls;
             delete cloneE.imageUrls;
             delete cloneF.sync_state;
             
             if (JSON.stringify(cloneF) !== JSON.stringify(cloneE) || !f.updated_at) {
                 f.sync_state = 'update';
                 f.updated_at = Date.now();
                 newFoods.push(f);
             } else {
                 f.sync_state = 'identical';
                 newFoods.push(f);
             }
         }

         if (f.imageUrl && f.imageUrl.length > 100) {
           zipPhotoMap.set(f.imageUrl, f);
         }
      });
      setResolutions(nextResolutions);

      importedBio.forEach(b => {
         const existing = existingBioMap.get(b.id);
         if (!existing) {
             b.sync_state = 'new';
             b.updated_at = Date.now();
             newBio.push(b);
         } else {
             const cloneB = { ...b };
             const cloneE = { ...existing };
             delete cloneB.updated_at;
             delete cloneE.updated_at;
             delete cloneB.sync_state;
             
             if (JSON.stringify(cloneB) !== JSON.stringify(cloneE) || !b.updated_at) {
                 b.sync_state = 'update';
                 b.updated_at = Date.now();
                 newBio.push(b);
             } else {
                 b.sync_state = 'identical';
                 newBio.push(b);
             }
         }
      });

      if (newFoods.length === 0 && newBio.length === 0) {
         setImportStatus(t(profile?.language, 'backupStNoChanges'));
         setTimeout(() => setImportStatus(''), 3000);
      } else {
         setStagedFoods(newFoods);
         setStagedBio(newBio);
         setSelectedFoods(new Set(newFoods.map(f => f.id)));
         setSelectedBio(new Set(newBio.map(b => b.id)));
         setShowConflicts(true);
         setImportStatus('');
      }

    } catch (e) {
      console.error(e);
      alert(t(profile?.language, 'alertBackupRead'));
      setImportStatus('');
    }
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApplyImport = () => {
     const mergedFoods = [...foodLogs];
     const existingMap = new Map(mergedFoods.map(f => [f.id, f]));
     
     stagedFoods.forEach(f => {
       if ((f.sync_state as string) === 'similar_photo') {
         const resInfo = resolutions[f.id];
         if (resInfo) {
           const { resolution, editData } = resInfo;
           if (resolution === 'keep_existing') {
             // If they edited the existing item, update it in the map
             const simId = f.similarTo?.id;
             if (simId) {
               existingMap.set(simId, editData);
             }
           } else if (resolution === 'keep_backup') {
             // Overwrite existing with backup
             const simId = f.similarTo?.id;
             if (simId) {
               existingMap.delete(simId);
             }
             existingMap.set(editData.id, editData);
           } else if (resolution === 'keep_both') {
             // Keep both!
             existingMap.set(editData.id, editData);
           }
         } else {
           if (selectedFoods.has(f.id)) {
             existingMap.set(f.id, f);
           }
         }
       } else {
         if (selectedFoods.has(f.id)) {
           existingMap.set(f.id, f);
         } else {
           const existing = existingMap.get(f.id);
           if (existing) {
             if (!existing.imageUrl && f.imageUrl && f.imageUrl !== "[image_removed_for_snapshot]") existing.imageUrl = f.imageUrl;
             if ((!existing.imageUrls || existing.imageUrls.length === 0) && f.imageUrls && f.imageUrls.length > 0) existing.imageUrls = f.imageUrls;
           }
         }
       }
     });
     
     const finalFoods = Array.from(existingMap.values());

     const bioToImport = stagedBio.filter(b => selectedBio.has(b.id));
     let finalBio = biomarkerHistory;
     if (bioToImport.length > 0) {
         const mergedBio = [...biomarkerHistory];
         const map = new Map(mergedBio.map(b => [b.id, b]));
         bioToImport.forEach(b => map.set(b.id, b));
         finalBio = Array.from(map.values());
     }

     if (onSaveAndSync) {
       setImportStatus(t(profile?.language, 'backupStSaving'));
       (() => {
         // Clean profile from any deleted log IDs for restored elements so they don't get filtered out
         const cleanProfile = profile ? { ...profile } : null;
         if (cleanProfile) {
           if (cleanProfile.deletedFoodLogIds) {
             cleanProfile.deletedFoodLogIds = { ...cleanProfile.deletedFoodLogIds };
             finalFoods.forEach(f => {
               if (cleanProfile.deletedFoodLogIds) {
                 delete cleanProfile.deletedFoodLogIds[f.id];
               }
             });
           }
           if (cleanProfile.deletedBiomarkerLogIds) {
             cleanProfile.deletedBiomarkerLogIds = { ...cleanProfile.deletedBiomarkerLogIds };
             finalBio.forEach(b => {
               if (cleanProfile.deletedBiomarkerLogIds) {
                 delete cleanProfile.deletedBiomarkerLogIds[b.id];
               }
             });
           }
         }

         // Explicitly clear quota lockouts to allow the manual restore write to attempt execution
         localStorage.removeItem('firestore_quota_exceeded');
         localStorage.removeItem('firestore_quota_exceeded_time');

         return onSaveAndSync(cleanProfile || profile, finalFoods, biomarkers, finalBio, actions || [], dailyBenefits || [], report, { type: 'fullPush' });
       })()
         .then(() => {
           setImportStatus(t(profile?.language, 'backupStSynced'));
           setTimeout(() => setImportStatus(''), 4000);
         })
         .catch((e) => {
           console.error(e);
           setImportStatus(t(profile?.language, 'backupStLocalOnly'));
           setTimeout(() => setImportStatus(''), 6000);
         });
     } else {
       // Fallback: no sync pipeline available, only update local React state.
       // This will NOT survive a refresh — surfaced to the user explicitly rather than
       // silently claiming success.
       setFoodLogs(finalFoods);
       setBiomarkerHistory(finalBio);
       setImportStatus(t(profile?.language, 'backupStNoCloud'));
       setTimeout(() => setImportStatus(''), 6000);
     }

     setShowConflicts(false);
     setStagedFoods([]);
     setStagedBio([]);
  };

  return (
    <div className="p-4 space-y-6">
      <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/50">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
          <Archive className="w-5 h-5 text-indigo-400" />
          Local Backup & Restore
        </h3>
        <p className="text-sm text-slate-400 mb-6">
          Create a full snapshot of your food logs and biomarker history (including images). This file can be kept offline and used to restore data if needed.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isExporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {isExporting ? 'Creating Snapshot...' : 'Create Snapshot Zip'}
          </button>
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isImporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            {isImporting ? 'Reading...' : 'Restore from Zip'}
          </button>
          <input 
            type="file" 
            accept=".zip" 
            ref={fileInputRef} 
            onChange={handleImport} 
            className="hidden" 
          />
        </div>
        
        {importStatus && (
          <div className="mt-4 text-sm text-indigo-400 flex items-center justify-center gap-2">
             <Check className="w-4 h-4" /> {importStatus}
          </div>
        )}
      </div>

            {showConflicts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-slate-900 sm:border border-slate-700 sm:rounded-2xl w-full h-full sm:h-[95vh] sm:max-w-6xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 bg-slate-800/50 flex items-center gap-3 shrink-0">
              <AlertCircle className="w-6 h-6 text-amber-500" />
              <h2 className="text-lg font-bold text-white">Review Data to Restore</h2>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
               <p className="text-sm text-slate-300 shrink-0">
                 Found <b>{stagedFoods.length}</b> new or updated food logs, and <b>{stagedBio.length}</b> new or updated biomarker records in the backup.
               </p>
               
               {stagedFoods.length > 0 && (
                 <div className="bg-slate-800 rounded-lg p-3">
                   <div className="flex items-center justify-between mb-2 border-b border-slate-700 pb-2">
                     <h4 className="text-sm font-semibold text-slate-200">Food Logs ({stagedFoods.length})</h4>
                     <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                       <input type="checkbox" checked={selectedFoods.size === stagedFoods.filter(f => (f.sync_state as string) !== "identical").length && stagedFoods.length > 0} onChange={(e) => {
                           if (e.target.checked) setSelectedFoods(new Set(stagedFoods.filter(f => (f.sync_state as string) !== "identical").map(f => f.id)));
                           else setSelectedFoods(new Set());
                       }} className="rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500" />
                       Select All Importable
                     </label>
                   </div>
                   <div className="space-y-3">
                     {[...stagedFoods].sort((a, b) => {
                       if ((a.sync_state as string) === "identical" && (b.sync_state as string) !== "identical") return 1;
                       if ((a.sync_state as string) !== "identical" && (b.sync_state as string) === "identical") return -1;
                       return 0;
                     }).map(f => {
                        const isSimilarPhoto = (f.sync_state as string) === 'similar_photo';
                        const isUpdate = (f.sync_state as string) === 'update';
                        const isIdentical = (f.sync_state as string) === 'identical';
                        const res = resolutions[f.id] || { resolution: 'keep_both', editData: f };
                        const sim = f.similarTo || (f as any).existingData;
                        const simSource = (f as any).similarSource || 'existing';
                        
                        const urls = (f.imageUrls && f.imageUrls.length > 0) ? f.imageUrls : (f.imageUrl ? [f.imageUrl] : []);
                        
                        return (
                          <div key={f.id} className={`text-xs text-slate-300 flex flex-col gap-3 bg-slate-850/50 p-3 rounded-xl border ${isIdentical ? 'border-slate-800 opacity-60' : 'border-slate-700/60'} hover:border-slate-600 transition-all`}>
                            {(!isSimilarPhoto && !isUpdate) ? (
                              <label className="flex items-center gap-3 cursor-pointer w-full">
                                {!isIdentical && (
                                  <input type="checkbox" checked={selectedFoods.has(f.id)} onChange={(e) => {
                                      const next = new Set(selectedFoods);
                                      if (e.target.checked) next.add(f.id); else next.delete(f.id);
                                      setSelectedFoods(next);
                                  }} className="rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500 flex-shrink-0" />
                                )}
                                {urls.length === 0 ? (
                                  <div className="w-20 h-20 rounded-lg bg-slate-600 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-8 h-8 text-slate-400" /></div>
                                ) : (
                                  <div className="w-20 h-20 flex-shrink-0 relative rounded-lg overflow-hidden group">
                                    <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-none">
                                      {urls.map((url, i) => (
                                        <img key={i} src={url} className="w-20 h-20 flex-shrink-0 object-cover snap-start" />
                                      ))}
                                    </div>
                                    {urls.length > 1 && (
                                      <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-md pointer-events-none">
                                        {urls.length} imgs
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="truncate font-medium text-slate-200 text-sm">{f.name || 'Unnamed Food'}</span>
                                  <span className="text-slate-500 text-[10px] mt-0.5">{f.date?.slice(0,10)}</span>
                                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 mt-1.5">
                                    <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">🔥 {f.nutrients?.calories ?? 0} kcal</span>
                                    {f.nutrients?.protein ? <span className="bg-slate-800 px-1.5 py-0.5 rounded">🥩 Pro: {f.nutrients.protein}g</span> : null}
                                    {f.nutrients?.totalFat ? <span className="bg-slate-800 px-1.5 py-0.5 rounded">🧈 Fat: {f.nutrients.totalFat}g</span> : null}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium">
                                    {f.sync_state === 'new' ? 'New Log' : 'Already Exists / Identical'}
                                  </span>
                                </div>
                              </label>
                            ) : (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-700/50">
                                  <div className="flex items-center gap-2">
                                    <input type="checkbox" checked={selectedFoods.has(f.id)} onChange={(e) => {
                                        const next = new Set(selectedFoods);
                                        if (e.target.checked) next.add(f.id); else next.delete(f.id);
                                        setSelectedFoods(next);
                                    }} className="rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500" />
                                    <span className="text-amber-400 font-medium">{isUpdate ? "Already Exists / Differs" : "Possible Duplicate Photo"}</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400">Resolve Conflict</span>
                                </div>
                                
                                <div className="flex gap-4 items-stretch">
                                  {/* Left side: Existing */}
                                  {sim && (
                                    <div className={`flex-1 p-2 rounded-xl border ${res.resolution === 'keep_existing' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-900'} cursor-pointer hover:border-slate-500`}
                                         onClick={() => { handleSetResolution(f.id, 'keep_existing', f); if(!selectedFoods.has(f.id)) setSelectedFoods(new Set(selectedFoods).add(f.id)); }}>
                                      <div className="text-[10px] font-semibold text-slate-400 mb-1.5">{isUpdate ? "Existing Record" : "Existing Photo"}</div>
                                      <div className="flex gap-2">
                                        {sim.imageUrl ? <img src={sim.imageUrl} className="w-16 h-16 rounded object-cover" /> : <div className="w-16 h-16 rounded bg-slate-800 flex items-center justify-center"><ImageIcon className="w-6 h-6 text-slate-600" /></div>}
                                        <div className="flex flex-col flex-1 min-w-0">
                                          <span className="truncate font-medium text-slate-300">{sim.name}</span>
                                          <span className="text-[9px] text-slate-500">{sim.date?.slice(0,10)}</span>
                                          <span className="text-[9px] text-slate-500 mt-1">🔥 {sim.nutrients?.calories ?? 0} kcal</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  
                                  {/* Right side: Backup (New) */}
                                  <div className={`flex-1 p-2 rounded-xl border ${res.resolution === 'keep_backup' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-900'} cursor-pointer hover:border-slate-500`}
                                       onClick={() => { handleSetResolution(f.id, 'keep_backup', f); if(!selectedFoods.has(f.id)) setSelectedFoods(new Set(selectedFoods).add(f.id)); }}>
                                    <div className="text-[10px] font-semibold text-slate-400 mb-1.5">Backup Record</div>
                                    <div className="flex gap-2">
                                      {urls.length === 0 ? <div className="w-16 h-16 rounded bg-slate-800 flex items-center justify-center"><ImageIcon className="w-6 h-6 text-slate-600" /></div> : (
                                          <div className="w-16 h-16 flex-shrink-0 relative rounded-lg overflow-hidden group">
                                            <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-none">
                                              {urls.map((url, i) => (
                                                <img key={i} src={url} className="w-16 h-16 flex-shrink-0 object-cover snap-start" />
                                              ))}
                                            </div>
                                          </div>
                                      )}
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="truncate font-medium text-slate-300">{f.name}</span>
                                        <span className="text-[9px] text-slate-500">{f.date?.slice(0,10)}</span>
                                        <span className="text-[9px] text-slate-500 mt-1">🔥 {f.nutrients?.calories ?? 0} kcal</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                {isSimilarPhoto && (
                                  <div className="mt-2 text-center">
                                    <button 
                                      className={`text-[10px] font-semibold px-3 py-1.5 rounded-full transition-all ${res.resolution === 'keep_both' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                      onClick={() => { handleSetResolution(f.id, 'keep_both', f); if(!selectedFoods.has(f.id)) setSelectedFoods(new Set(selectedFoods).add(f.id)); }}
                                    >
                                      Keep Both (Import as new entry)
                                    </button>
                                  </div>
                                )}
                                
                                {/* Edit block if needed... keeping simple for now */}
                              </div>
                            )}
                          </div>
                        );
                     })}
                   </div>
                 </div>
               )}

               {stagedBio.length > 0 && (
                 <div className="bg-slate-800 rounded-lg p-3">
                   <div className="flex items-center justify-between mb-2 border-b border-slate-700 pb-2">
                     <h4 className="text-sm font-semibold text-slate-200">Biomarkers ({stagedBio.length})</h4>
                     <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                       <input type="checkbox" checked={selectedBio.size === stagedBio.filter(b => (b.sync_state as string) !== "identical").length && stagedBio.length > 0} onChange={(e) => {
                           if (e.target.checked) setSelectedBio(new Set(stagedBio.filter(b => (b.sync_state as string) !== "identical").map(b => b.id)));
                           else setSelectedBio(new Set());
                       }} className="rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500" />
                       Select All Importable
                     </label>
                   </div>
                   <div className="space-y-2">
                     {[...stagedBio].sort((a, b) => {
                       if ((a.sync_state as string) === "identical" && (b.sync_state as string) !== "identical") return 1;
                       if ((a.sync_state as string) !== "identical" && (b.sync_state as string) === "identical") return -1;
                       return 0;
                     }).map(b => {
                       const isIdentical = (b.sync_state as string) === "identical";
                       const bioEntries = Object.entries(b.biomarkers || {});
                       const titleText = bioEntries.length > 0 
                         ? bioEntries.slice(0, 2).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' && v !== null ? (v as any).value : v}`).join(' | ') + (bioEntries.length > 2 ? ` (+${bioEntries.length - 2} more)` : '')
                         : 'Empty Record';
                       return (
                         <label key={b.id} className={`text-xs text-slate-300 flex items-center gap-3 cursor-pointer bg-slate-850/50 p-3 rounded-xl border ${isIdentical ? 'border-slate-800 opacity-60' : 'border-slate-700/60'} hover:border-slate-600 transition-all`}>
                           {!isIdentical && (
                             <input type="checkbox" checked={selectedBio.has(b.id)} onChange={(e) => {
                                 const next = new Set(selectedBio);
                                 if (e.target.checked) next.add(b.id); else next.delete(b.id);
                                 setSelectedBio(next);
                             }} className="rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500 flex-shrink-0" />
                           )}
                           
                           <div className="flex flex-col flex-1 min-w-0">
                             <span className="truncate font-medium text-slate-200 capitalize text-sm">{titleText}</span>
                             <span className="text-slate-500 text-[10px] mt-0.5">{b.date?.slice(0,10)}</span>
                           </div>

                           <div className="flex-shrink-0">
                             <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium">
                               {b.sync_state === 'new' ? 'New Log' : b.sync_state === 'update' ? 'Already Exists / Differs' : 'Already Exists / Identical'}
                             </span>
                           </div>
                         </label>
                       );
                     })}
                   </div>
                 </div>
               )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-800/50 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => { setShowConflicts(false); setStagedFoods([]); setStagedBio([]); }}
                className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyImport}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg"
              >
                Import & Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}