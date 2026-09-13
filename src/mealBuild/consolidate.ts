import { MealBuild, MealFoodItem, StageAuditRecord, HistoryLogEntry } from './types';
import { CRITICAL_PRESERVE_FIELDS } from './fieldInventory';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function makeStageKey(mealId: string, stage: string, attempt: number): string {
  return `${mealId}_${stage}_${attempt}`;
}

export function mergeFoodItem(prev: MealFoodItem | undefined, patch: Partial<MealFoodItem>): MealFoodItem {
  if (!prev) return { ...patch };
  const merged: MealFoodItem = { ...prev };
  
  for (const [key, value] of Object.entries(patch)) {
    if (CRITICAL_PRESERVE_FIELDS.includes(key)) {
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
        continue;
      }
    }
    merged[key] = value;
  }
  return merged;
}

export function appendStageLedger(meal: MealBuild, record: StageAuditRecord): MealBuild {
  const ledger = meal.stageLedger ? [...meal.stageLedger] : [];
  const idx = ledger.findIndex(r => r.stageKey === record.stageKey);
  if (idx >= 0) {
    ledger[idx] = record;
  } else {
    ledger.push(record);
  }
  return { ...meal, stageLedger: ledger };
}

export function appendHistory(meal: MealBuild, entry: Omit<HistoryLogEntry, 'seq' | 'id'> & { id?: string }): MealBuild {
  const history = meal.historyLog ? [...meal.historyLog] : [];
  const seq = history.length > 0 ? Math.max(...history.map(h => h.seq)) + 1 : 1;
  const newEntry: HistoryLogEntry = {
    ...entry,
    id: entry.id || generateId(),
    seq
  };
  
  history.push(newEntry);
  
  // Cap with pin last error + last user_action (plan 10.2)
  if (history.length > 50) {
    const lastError = history.filter(h => h.type === 'error').pop();
    const lastUserAction = history.filter(h => h.type === 'user_action').pop();
    const kept = history.slice(-30);
    if (lastError && !kept.find(h => h.id === lastError.id)) kept.unshift(lastError);
    if (lastUserAction && !kept.find(h => h.id === lastUserAction.id)) kept.unshift(lastUserAction);
    return { ...meal, historyLog: kept.sort((a, b) => a.seq - b.seq) };
  }
  return { ...meal, historyLog: history };
}

export function migrateMealSchema(json: any): MealBuild {
  if (!json) return {} as MealBuild;
  if (json.schemaVersion === 1) return json as MealBuild;
  
  // Basic migration
  const migrated: MealBuild = {
    ...json,
    id: json.id || generateId(),
    schemaVersion: 1,
    version: json.version || 1,
    mode: json.mode || 'new_log',
    items: Array.isArray(json.items) && json.items.length > 0 ? json.items.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
      itemId: i.itemId || generateId()
    })) : (Array.isArray(json.itemsBreakdown) ? json.itemsBreakdown.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
      itemId: i.itemId || generateId()
    })) : []),
    nutrients: json.nutrients || {},
  };
  return migrated;
}

export function consolidateMeal(
  prev: MealBuild | null,
  patch: Partial<MealBuild>,
  stage: string,
  opts?: { stageKey?: string; expectedVersion?: number; actor?: string; attempt?: number }
): MealBuild {
  const base = prev ? { ...prev } : migrateMealSchema({});
  
  // OCC Version Check
  let version = base.version || 1;
  if (opts?.expectedVersion !== undefined && opts.expectedVersion !== version) {
    // Rebase: user-owned keys win
    if (opts.actor === 'user') {
      version = opts.expectedVersion + 1;
    } else {
      // job patch but user changed underneath, job wins non-conflicting
      version = version + 1;
    }
  } else if (Object.keys(patch).length > 0) {
    version += 1;
  }
  
  const merged: MealBuild = { ...base, ...patch, version };
  
  // Merge items
  if (patch.items) {
    const newItems: MealFoodItem[] = [];
    const deletedIds = new Set(base.deletedItemIds || []);
    
    // Existing items map
    const existingItems = new Map<string, MealFoodItem>();
    base.items.forEach(i => {
      const key = i.itemId || (i.scoutIndex != null ? `scout_${i.scoutIndex}` : `name_${i.name}_${i.weightGrams}`);
      existingItems.set(key, i);
    });
    
    patch.items.forEach(patchItem => {
      const key = patchItem.itemId || (patchItem.scoutIndex != null ? `scout_${patchItem.scoutIndex}` : `name_${patchItem.name}_${patchItem.weightGrams}`);
      if (patchItem.itemId && deletedIds.has(patchItem.itemId)) {
        return; // Skip deleted (zombie)
      }
      
      let prevItem = existingItems.get(key);
      let matchedKey = key;
      if (!prevItem && patchItem.scoutIndex != null) {
        // Fallback: if patch has scoutIndex, find base item by scoutIndex (e.g. base had itemId, patch only has scoutIndex)
        for (const [k, it] of existingItems.entries()) {
          if (it.scoutIndex === patchItem.scoutIndex) {
            prevItem = it;
            matchedKey = k;
            break;
          }
        }
      } else if (!prevItem && patchItem.name) {
        // Fallback: match by name
        for (const [k, it] of existingItems.entries()) {
          if (it.name && it.name.toLowerCase().trim() === patchItem.name.toLowerCase().trim()) {
            prevItem = it;
            matchedKey = k;
            break;
          }
        }
      }
      const mergedItem = mergeFoodItem(prevItem, patchItem);
      
      // Structural/weight change detection
      if (prevItem && stage !== 'diet') {
        if (mergedItem.weightGrams !== prevItem.weightGrams || mergedItem.name !== prevItem.name) {
          merged.staleDietNarrative = true;
        }
      }
      
      newItems.push(mergedItem);
      existingItems.delete(matchedKey);
    });
    
    // Bring over untouched items
    existingItems.forEach((item, key) => {
      if (item.itemId && deletedIds.has(item.itemId)) return;
      newItems.push(item);
    });
    
    merged.items = newItems;
  }
  
  if (opts?.stageKey) {
    const record: StageAuditRecord = {
      stageKey: opts.stageKey,
      stage,
      attempt: opts.attempt || 1,
      timestamp: new Date().toISOString(),
      status: 'success',
      actor: opts.actor
    };
    return appendStageLedger(merged, record);
  }
  
  return merged;
}

export function rebaseUserEdit(
  serverMeal: MealBuild,
  localUserPatch: Partial<MealBuild>,
  attempt: number = 1
): { rebasedMeal: MealBuild; success: boolean } {
  if (attempt > 3) {
    const errorMeal = appendHistory(serverMeal, {
      type: 'error',
      stage: 'rebase',
      timestamp: new Date().toISOString(),
      message: "Couldn't sync edit after 3 rebase attempts — tap Retry"
    });
    return { rebasedMeal: errorMeal, success: false };
  }

  const combinedDeleted = Array.from(new Set([
    ...(serverMeal.deletedItemIds || []),
    ...(localUserPatch.deletedItemIds || [])
  ]));

  const patchWithDeleted: Partial<MealBuild> = {
    ...localUserPatch,
    deletedItemIds: combinedDeleted
  };

  const rebased = consolidateMeal(serverMeal, patchWithDeleted, 'user_edit', {
    expectedVersion: serverMeal.version,
    actor: 'user',
    attempt
  });

  const updatedMeal = appendHistory(rebased, {
    type: 'user_action',
    stage: 'user_edit',
    timestamp: new Date().toISOString(),
    message: `Rebased user edit on server version ${serverMeal.version} (attempt ${attempt})`
  });

  return { rebasedMeal: updatedMeal, success: true };
}
