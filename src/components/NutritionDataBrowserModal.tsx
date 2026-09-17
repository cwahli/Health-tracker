import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Database,
  X,
  RefreshCw,
  Link2,
  AlertTriangle,
  Leaf,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Save,
  ClipboardPaste,
  Pencil,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  Sparkles,
} from 'lucide-react';
import { parseMenuNutritionPaste, parseMenuNutritionBulkPaste, cleanDescriptionText } from '../utils/parseMenuNutritionPaste';
import { ComprehensiveNutrientsTable } from './chat-cards/ComprehensiveNutrientsTable';
import { defaultServingSizeFor } from '../utils/servingSizeDefaults';
import { translations } from '../utils/translations';
import { interpolate } from '../utils/i18n';

const renderNutrientSummaryLine = (nutrients: any) => {
  if (!nutrients || typeof nutrients !== 'object') return 'kcal —';
  
  const parts: string[] = [];
  
  if (nutrients.calories != null && nutrients.calories !== '' && nutrients.calories !== '—') {
    parts.push(`kcal ${nutrients.calories}`);
  } else {
    parts.push(`kcal —`);
  }

  if (nutrients.protein != null && nutrients.protein !== '' && nutrients.protein !== '—') {
    parts.push(`P ${nutrients.protein}g`);
  }
  if (nutrients.carbohydrates != null && nutrients.carbohydrates !== '' && nutrients.carbohydrates !== '—') {
    parts.push(`C ${nutrients.carbohydrates}g`);
  }
  if (nutrients.sugar != null && nutrients.sugar !== '' && nutrients.sugar !== '—') {
    parts.push(`Sugar ${nutrients.sugar}g`);
  }
  const fatVal = nutrients.totalFat ?? nutrients.fat;
  if (fatVal != null && fatVal !== '' && fatVal !== '—') {
    parts.push(`F ${fatVal}g`);
  }
  if (nutrients.saturatedFat != null && nutrients.saturatedFat !== '' && nutrients.saturatedFat !== '—') {
    parts.push(`Sat Fat ${nutrients.saturatedFat}g`);
  }
  const fiberVal = nutrients.totalFibre ?? nutrients.fiber;
  if (fiberVal != null && fiberVal !== '' && fiberVal !== '—') {
    parts.push(`Fiber ${fiberVal}g`);
  }
  const saltVal = nutrients.salt ?? (nutrients.sodium ? (nutrients.sodium / 400).toFixed(1) : null);
  if (saltVal != null && saltVal !== '' && saltVal !== '—') {
    parts.push(`Salt ${saltVal}g`);
  }

  return parts.join(' · ');
};

const toScoutItem = (item: any, language?: string) => {
  if (!item) return null;
  const nuts = item.nutrients || {};
  const t = translations[language || 'en'] || translations.en;
  return {
    originalName: item.dish_name || item.originalName || item.keyword,
    rawNutritionLabel: {
      servingSize: t.oneServingDefault,
      calories: nuts.calories != null && nuts.calories !== '' && nuts.calories !== '—' ? `${nuts.calories} kcal` : undefined,
      protein: nuts.protein != null && nuts.protein !== '' && nuts.protein !== '—' ? `${nuts.protein}g` : undefined,
      totalFat: (nuts.totalFat ?? nuts.fat) != null && (nuts.totalFat ?? nuts.fat) !== '' && (nuts.totalFat ?? nuts.fat) !== '—' ? `${nuts.totalFat ?? nuts.fat}g` : undefined,
      saturatedFat: nuts.saturatedFat != null && nuts.saturatedFat !== '' && nuts.saturatedFat !== '—' ? `${nuts.saturatedFat}g` : undefined,
      totalCarbohydrate: nuts.carbohydrates != null && nuts.carbohydrates !== '' && nuts.carbohydrates !== '—' ? `${nuts.carbohydrates}g` : undefined,
      sugar: nuts.sugar != null && nuts.sugar !== '' && nuts.sugar !== '—' ? `${nuts.sugar}g` : undefined,
      totalFibre: (nuts.totalFibre ?? nuts.fiber) != null && (nuts.totalFibre ?? nuts.fiber) !== '' && (nuts.totalFibre ?? nuts.fiber) !== '—' ? `${nuts.totalFibre ?? nuts.fiber}g` : undefined,
      sodium: nuts.sodium != null && nuts.sodium !== '' && nuts.sodium !== '—' ? `${nuts.sodium}mg` : undefined,
      salt: nuts.salt != null && nuts.salt !== '' && nuts.salt !== '—' ? `${nuts.salt}g` : (nuts.sodium ? `${(nuts.sodium / 400).toFixed(1)}g` : undefined)
    },
    ingredientsList: cleanDescriptionText(item.ingredients || item.ingredientsList || item.description || ''),
    isRealTruth: true,
    estimatedWeightGrams: 100
  };
};

const toCatalogScoutItem = (item: any) => {
  if (!item) return null;
  const n = item.nutrients_per_100g || item.core_nutrients || {};
  const safe = (v: any, suffix: string) => v != null && v !== '' && v !== '—' ? `${v}${suffix}` : undefined;
  return {
    originalName: item.display_name || item.food_key || item.dish_key || item.id,
    rawNutritionLabel: {
      servingSize: '100g',
      calories:           safe(n.calories, ' kcal'),
      protein:            safe(n.protein, 'g'),
      totalFat:           safe(n.totalFat ?? n.fat, 'g'),
      saturatedFat:       safe(n.saturatedFat, 'g'),
      transFat:           safe(n.transFat, 'g'),
      totalCarbohydrate:  safe(n.carbohydrates ?? n.totalCarbohydrate, 'g'),
      sugar:              safe(n.sugar, 'g'),
      addedSugar:         safe(n.addedSugar, 'g'),
      sodium:             safe(n.sodium, 'mg'),
      salt:               safe(n.salt ?? (n.sodium ? (n.sodium / 400).toFixed(2) : null), 'g'),
      potassium:          safe(n.potassium, 'mg'),
      totalFibre:         safe(n.totalFibre ?? n.fiber, 'g'),
      solubleFibre:       safe(n.solubleFibre, 'g'),
      omega3:             safe(n.omega3, 'g'),
      magnesium:          safe(n.magnesium, 'mg'),
      calcium:            safe(n.calcium, 'mg'),
      iron:               safe(n.iron, 'mg'),
      zinc:               safe(n.zinc, 'mg'),
      selenium:           safe(n.selenium, 'mcg'),
      iodine:             safe(n.iodine, 'mcg'),
      phosphorus:         safe(n.phosphorus, 'mg'),
      vitaminD:           safe(n.vitaminD, ' IU'),
      vitaminB12:         safe(n.vitaminB12, 'mcg'),
      folate:             safe(n.folate, 'mcg'),
      vitaminC:           safe(n.vitaminC, 'mg'),
      vitaminE:           safe(n.vitaminE, 'mg'),
      vitaminK:           safe(n.vitaminK, 'mcg'),
      vitaminA:           safe(n.vitaminA, 'mcg'),
      vitaminB6:          safe(n.vitaminB6, 'mg'),
      thiamine:           safe(n.thiamine, 'mg'),
      riboflavin:         safe(n.riboflavin, 'mg'),
      niacin:             safe(n.niacin, 'mg'),
    },
    ingredientsList: item.ingredients || item.description || '',
    isRealTruth: true,
    estimatedWeightGrams: 100
  };
};

type TabId = 'chains' | 'base' | 'unfetched' | 'catalog';

interface NutritionDataBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  language?: string;
}

/** Force readable copy: white on dark */
const textPrimary = 'text-white';
const textSecondary = 'text-white/90';
const textMuted = 'text-white/75';
const preBlock =
  'text-[10px] text-white bg-black/40 p-2 rounded-lg overflow-auto font-mono border border-white/10';
const card =
  'border border-white/15 rounded-xl p-3 space-y-1.5 bg-slate-800/90 text-white';
const inputCls = 'bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500';

export default function NutritionDataBrowserModal({ isOpen, onClose, language }: NutritionDataBrowserModalProps) {
  const t = translations[language || 'en'] || translations.en;
  const [tab, setTab] = useState<TabId>('chains');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [pasteDrafts, setPasteDrafts] = useState<Record<string, string>>({});
  const [pastePreview, setPastePreview] = useState<Record<string, any>>({});
  const [bulkDrafts, setBulkDrafts] = useState<Record<string, string>>({});
  const [bulkPreview, setBulkPreview] = useState<Record<string, any>>({});
  const [bulkResults, setBulkResults] = useState<Record<string, any>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteChainId, setConfirmDeleteChainId] = useState<string | null>(null);
  const [deletingChainId, setDeletingChainId] = useState<string | null>(null);
  const [expandedChains, setExpandedChains] = useState<Record<string, boolean>>({});
  const [chainItems, setChainItems] = useState<Record<string, any[]>>({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingChainId, setEditingChainId] = useState<string | null>(null);
  
  // Catalog states
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogType, setCatalogType] = useState<'food' | 'dish'>('food');
  const [catalogStatus, setCatalogStatus] = useState<'all' | 'active' | 'candidate' | 'quarantine'>('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCatalogKey, setSelectedCatalogKey] = useState<string | null>(null);
  const [editChainForm, setEditChainForm] = useState({
    id: '',
    chain_key: '',
    display_name: '',
    url: ''
  });
  const [showAddChain, setShowAddChain] = useState(false);
  const [addChainForm, setAddChainForm] = useState({
    chain_key: '',
    display_name: '',
    url: ''
  });
  const [syncing, setSyncing] = useState(false);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<any[] | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);

  // Meal photo linking state
  const [showMealLinkModal, setShowMealLinkModal] = useState(false);
  const [mealLinkTargetItem, setMealLinkTargetItem] = useState<any>(null);
  const [mealsWithPhotos, setMealsWithPhotos] = useState<any[]>([]);
  const [loadingMealsWithPhotos, setLoadingMealsWithPhotos] = useState(false);
  const [selectedMealForLink, setSelectedMealForLink] = useState<any>(null);
  const [selectedPhotoIndexForLink, setSelectedPhotoIndexForLink] = useState(0);
  const [copyNutrientsOnLink, setCopyNutrientsOnLink] = useState(true);

  const openMealLinkPicker = async (item: any) => {
    setMealLinkTargetItem(item);
    setSelectedMealForLink(null);
    setSelectedPhotoIndexForLink(0);
    setCopyNutrientsOnLink(!item.nutrients?.calories && !item.calories);
    setShowMealLinkModal(true);
    setLoadingMealsWithPhotos(true);
    try {
      const res = await fetch('/api/admin/meals-with-photos');
      const json = await res.json();
      if (json.success && Array.isArray(json.meals)) {
        setMealsWithPhotos(json.meals);
      }
    } catch (e) {
      console.warn('Failed to load meals with photos:', e);
    } finally {
      setLoadingMealsWithPhotos(false);
    }
  };

  const confirmMealLink = async () => {
    if (!mealLinkTargetItem || !selectedMealForLink) return;
    const photoUrls = selectedMealForLink.imageUrls?.length > 0 ? selectedMealForLink.imageUrls : (selectedMealForLink.imageUrl ? [selectedMealForLink.imageUrl] : []);
    const chosenPhoto = photoUrls[selectedPhotoIndexForLink] || selectedMealForLink.imageUrl;
    if (!chosenPhoto) {
      alert("Selected meal has no valid photo URL");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/brand-menu-items/link-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandItemId: mealLinkTargetItem.id,
          chain_key: mealLinkTargetItem.chain_key,
          dish_name_key: mealLinkTargetItem.dish_name_key,
          mealLogId: selectedMealForLink.id,
          photoIndex: selectedPhotoIndexForLink,
          copyNutrients: copyNutrientsOnLink,
          photoUrl: chosenPhoto
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to link meal");

      setEditForm((prev: any) => ({
        ...prev,
        image_url: chosenPhoto,
        ...(copyNutrientsOnLink && selectedMealForLink.calories ? {
          calories: selectedMealForLink.calories,
          protein: selectedMealForLink.protein ?? prev.protein,
          carbohydrates: selectedMealForLink.carbohydrates ?? prev.carbohydrates,
          totalFat: selectedMealForLink.totalFat ?? prev.totalFat,
          saturatedFat: selectedMealForLink.saturatedFat ?? prev.saturatedFat,
          sodium: selectedMealForLink.sodium ?? prev.sodium
        } : {})
      }));

      if (mealLinkTargetItem.chain_key) {
        await loadChainItems(mealLinkTargetItem.chain_key);
      }
      if (globalSearch.trim()) {
        await runGlobalSearch(globalSearch);
      }

      setShowMealLinkModal(false);
      setSyncBanner(`Linked meal photo to ${mealLinkTargetItem.dish_name}`);
      setTimeout(() => setSyncBanner(null), 4000);
    } catch (err: any) {
      alert(err?.message || "Failed to link meal");
    } finally {
      setBusy(false);
    }
  };

  const saveChainSource = async () => {
    if (!editChainForm.display_name.trim() || !editChainForm.url.trim()) {
      alert(t.browserAlertChainRequired);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/chain-menu-sources/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editChainForm.id,
          chain_key: editChainForm.chain_key,
          display_name: editChainForm.display_name,
          url: editChainForm.url
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Failed to save (HTTP ${res.status})`);
      }
      setEditingChainId(null);
      await load();
    } catch (e: any) {
      alert(e?.message || t.browserAlertSaveChain);
    } finally {
      setBusy(false);
    }
  };

  const saveNewChainSource = async () => {
    if (!addChainForm.chain_key.trim() || !addChainForm.url.trim()) {
      alert(t.browserAlertChainKeyRequired);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/chain-menu-sources/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain_key: addChainForm.chain_key,
          display_name: addChainForm.display_name || addChainForm.chain_key,
          url: addChainForm.url
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Failed to add (HTTP ${res.status})`);
      }
      setAddChainForm({ chain_key: '', display_name: '', url: '' });
      setShowAddChain(false);
      await load();
    } catch (e: any) {
      alert(e?.message || t.browserAlertAddChain);
    } finally {
      setBusy(false);
    }
  };

  const [editForm, setEditForm] = useState<any>({
    dish_name: '',
    calories: '',
    protein: '',
    carbohydrates: '',
    totalFat: '',
    saturatedFat: '',
    sugar: '',
    totalFibre: '',
    salt: '',
    sodium: '',
    notes: '',
    ingredients: '',
    image_url: '',
    basis_type: 'per_dish',
    serving_grams: ''
  });

  const saveEdit = async (item: any) => {
    setBusy(true);
    try {
      const saltVal = editForm.salt === '' ? null : Number(editForm.salt);
      let sodiumVal = editForm.sodium === '' ? null : Number(editForm.sodium);
      if (sodiumVal == null && saltVal != null) {
        sodiumVal = Math.round(saltVal * 400);
      }

      let finalBasis = editForm.basis_type;
      if (!finalBasis || finalBasis.trim() === '') {
        const def = defaultServingSizeFor('restaurant');
        finalBasis = def.basisType;
        setSyncBanner(interpolate(t.browserServingDefaulted, { label: def.label }));
        setTimeout(() => setSyncBanner(null), 5000);
      }

      const res = await fetch('/api/brand-menu-items/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_code: item.country_code || 'GB',
          chain_key: item.chain_key,
          dish_name_key: item.dish_name_key,
          dish_name: editForm.dish_name,
          serving_grams: editForm.serving_grams === '' ? null : Number(editForm.serving_grams),
          basis_type: finalBasis,
          image_url: editForm.image_url ? String(editForm.image_url).trim() : null,
          nutrients: {
            calories: editForm.calories === '' ? null : Number(editForm.calories),
            protein: editForm.protein === '' ? null : Number(editForm.protein),
            carbohydrates: editForm.carbohydrates === '' ? null : Number(editForm.carbohydrates),
            totalFat: editForm.totalFat === '' ? null : Number(editForm.totalFat),
            saturatedFat: editForm.saturatedFat === '' ? null : Number(editForm.saturatedFat),
            sugar: editForm.sugar === '' ? null : Number(editForm.sugar),
            totalFibre: editForm.totalFibre === '' ? null : Number(editForm.totalFibre),
            salt: saltVal,
            sodium: sodiumVal
          },
          ingredients: cleanDescriptionText(editForm.ingredients)
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Save failed (HTTP ${res.status})`);
      }
      setEditingItemId(null);
      if (item.chain_key) {
        await loadChainItems(item.chain_key);
      }
      if (globalSearch.trim()) {
        await runGlobalSearch(globalSearch);
      }
    } catch (e: any) {
      alert(e?.message || t.browserAlertSaveFailed);
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (item: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const itemKey = `${item.chain_key}:${item.dish_name_key}`;
    if (confirmDeleteId !== itemKey && confirmDeleteId !== item.dish_name_key) {
      setConfirmDeleteId(itemKey);
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    setConfirmDeleteId(null);
    setDeletingItemId(itemKey);

    // Optimistically remove the item from local chainItems list
    if (item.chain_key) {
      setChainItems((prev) => ({
        ...prev,
        [item.chain_key]: (prev[item.chain_key] || []).filter(
          (it: any) => it.dish_name_key !== item.dish_name_key
        )
      }));
    }

    try {
      const res = await fetch('/api/brand-menu-items/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_code: item.country_code || 'GB',
          chain_key: item.chain_key,
          dish_name_key: item.dish_name_key
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Delete failed (HTTP ${res.status})`);
      }
      if (item.chain_key) {
        await loadChainItems(item.chain_key);
      }
      if (globalSearch.trim()) {
        await runGlobalSearch(globalSearch);
      }
    } catch (e: any) {
      alert(e?.message || t.browserAlertDeleteFailed);
      if (item.chain_key) {
        await loadChainItems(item.chain_key);
      }
    } finally {
      setDeletingItemId(null);
    }
  };

  const deleteChainSource = async (chain: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const chainIdentifier = chain.id || chain.chain_key;
    if (confirmDeleteChainId !== chainIdentifier) {
      setConfirmDeleteChainId(chainIdentifier);
      setTimeout(() => setConfirmDeleteChainId(null), 3500);
      return;
    }
    setConfirmDeleteChainId(null);
    setDeletingChainId(chainIdentifier);

    // Optimistically remove from state so the modal stays at the current scroll position
    setData((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        chainSources: (prev.chainSources || []).filter(
          (s: any) => s.id !== chain.id && s.chain_key !== chain.chain_key
        )
      };
    });

    try {
      const res = await fetch('/api/chain-menu-sources/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: chain.id,
          chain_key: chain.chain_key,
          country_code: chain.country_code || 'GB'
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Delete failed (HTTP ${res.status})`);
      }
      if (globalSearch.trim()) {
        await runGlobalSearch(globalSearch);
      }
    } catch (e: any) {
      alert(e?.message || t.browserAlertDeleteBrand);
      await load();
    } finally {
      setDeletingChainId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/nutrition-data/overview?country=GB');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const loadCatalog = async (q?: string) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(
        `/api/admin/food-catalog?type=${catalogType}&status=${catalogStatus}&search=${encodeURIComponent(q !== undefined ? q : catalogSearch)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCatalogItems(json.items || []);
    } catch (e: any) {
      setCatalogError(e?.message || 'Failed to load food catalog');
      setCatalogItems([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && tab === 'catalog') {
      loadCatalog();
    }
  }, [isOpen, tab, catalogType, catalogStatus]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  const [cleaning, setCleaning] = useState(false);
  const [cleanDuplicates, setCleanDuplicates] = useState<{ chain_key: string; dish_name: string; kept: number; removed: number }[]>([]);

  const triggerSelfCleaning = async () => {
    setCleaning(true);
    setSyncBanner(null);
    try {
      const res = await fetch('/api/admin/db-clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Clean failed (HTTP ${res.status})`);

      const cStats = json.chainStats || {};
      const fStats = json.catalogStats || {};
      setSyncBanner(
        `Self-cleaning complete: ${cStats.updatedChainsCount || 0} chain keys unified, ${cStats.deletedDuplicatesCount || 0} duplicate items deleted, ${fStats.purgedBrandedCount || 0} branded items purged.`
      );
      setCleanDuplicates(cStats.duplicatesFound || []);
      await load();
      if (tab === 'catalog') loadCatalog();
      for (const key of Object.keys(expandedChains)) {
        if (expandedChains[key]) await loadChainItems(key);
      }
    } catch (e: any) {
      setSyncBanner(e?.message || 'Self-cleaning failed');
    } finally {
      setCleaning(false);
      setTimeout(() => setSyncBanner(null), 8000);
    }
  };

  const syncPendingToSupabase = async () => {
    setSyncing(true);
    setSyncBanner(null);
    try {
      const res = await fetch('/api/brand-menu-items/sync-to-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country_code: 'GB' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Sync failed (HTTP ${res.status})`);
      }
      setSyncBanner(
        json.synced > 0 || json.failed > 0
          ? `Synced ${json.synced} item(s) to Supabase${json.failed > 0 ? `, ${json.failed} still failed${json.sampleErrors?.length ? `: ${json.sampleErrors[0]}` : ''}` : ''}.`
          : 'Nothing to sync — all items already in Supabase.'
      );
      await load();
      for (const key of Object.keys(expandedChains)) {
        if (expandedChains[key]) await loadChainItems(key);
      }
    } catch (e: any) {
      setSyncBanner(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncBanner(null), 6000);
    }
  };

  const runGlobalSearch = async (q: string) => {
    setGlobalSearch(q);
    if (!q.trim()) {
      setGlobalSearchResults(null);
      return;
    }
    setGlobalSearchLoading(true);
    try {
      const res = await fetch(`/api/brand-menu-items/search?q=${encodeURIComponent(q)}&country_code=GB`);
      const json = await res.json().catch(() => ({}));
      setGlobalSearchResults(json.items || []);
    } catch (e) {
      setGlobalSearchResults([]);
    } finally {
      setGlobalSearchLoading(false);
    }
  };

  const pasteAndSave = async (chain_key: string) => {
    const text = (pasteDrafts[chain_key] || '').trim();
    if (!text) {
      alert(t.browserAlertPastePanel);
      return;
    }
    const local = parseMenuNutritionPaste(text);
    setPastePreview((prev) => ({ ...prev, [chain_key]: local }));
    setBusy(true);
    try {
      const res = await fetch('/api/brand-menu-items/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain_key, text, country_code: 'GB' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || interpolate(t.browserAlertPasteSaveFailed, { status: res.status }));
        return;
      }
      setPasteDrafts((prev) => ({ ...prev, [chain_key]: '' }));
      setPastePreview((prev) => {
        const next = { ...prev };
        delete next[chain_key];
        return next;
      });
      const warn = (json.parsed?.warnings || []).join('; ');
      alert(
        interpolate(t.browserAlertPasteAdded, {
          dish: json.item?.dish_name || local.dish_name,
          kcal: json.item?.nutrients?.calories ?? local.nutrients.calories,
          p: json.item?.nutrients?.protein ?? local.nutrients.protein,
          c: json.item?.nutrients?.carbohydrates ?? local.nutrients.carbohydrates,
          f: json.item?.nutrients?.totalFat ?? local.nutrients.totalFat,
          warn: warn ? interpolate(t.browserAlertPasteNote, { warn }) : ''
        })
      );
      await load();
      await loadChainItems(chain_key);
    } catch (e: any) {
      alert(e?.message || t.browserAlertPasteFailed);
    } finally {
      setBusy(false);
    }
  };

  const bulkPasteAndSave = async (chain_key: string) => {
    const text = (bulkDrafts[chain_key] || '').trim();
    if (!text) {
      alert(t.browserAlertPasteSection);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/brand-menu-items/bulk-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain_key, text, country_code: 'GB' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || interpolate(t.browserAlertBulkSaveFailed, { status: res.status }));
        return;
      }
      setBulkResults((prev) => ({ ...prev, [chain_key]: json }));
      setBulkDrafts((prev) => ({ ...prev, [chain_key]: '' }));
      setBulkPreview((prev) => {
        const next = { ...prev };
        delete next[chain_key];
        return next;
      });
      await load();
      await loadChainItems(chain_key);
    } catch (e: any) {
      alert(e?.message || t.browserAlertBulkFailed);
    } finally {
      setBusy(false);
    }
  };

  const loadChainItems = async (chain_key: string) => {
    try {
      const res = await fetch(`/api/brand-menu-items?chain_key=${chain_key}&country_code=GB`);
      if (res.ok) {
        const json = await res.json();
        setChainItems((prev) => ({ ...prev, [chain_key]: json.items || [] }));
      }
    } catch (e) {
      console.warn('loadChainItems failed:', e);
    }
  };

  const toggleChainExpand = async (chain_key: string) => {
    const isExpanding = !expandedChains[chain_key];
    setExpandedChains((prev) => ({ ...prev, [chain_key]: isExpanding }));
    if (isExpanding) {
      await loadChainItems(chain_key);
    }
  };

  if (!isOpen) return null;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'chains', label: t.browserTabBranded, count: data?.chainSources?.length },
    { id: 'base', label: t.browserTabBase, count: data?.baseFoodCache?.length },
    { id: 'catalog', label: t.browserTabCatalog, count: catalogItems.length },
    { id: 'unfetched', label: t.browserTabPending, count: data?.chainNotFetched?.length },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[10050] bg-slate-950/85 backdrop-blur-sm flex flex-col">
      <div className="flex-1 bg-slate-900 flex flex-col overflow-hidden text-white">
        <div className="px-4 py-3 border-b border-white/15 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-5 h-5 text-indigo-300 shrink-0" />
            <div className="min-w-0">
              <h2 className={`text-base font-bold truncate ${textPrimary}`}>{t.browserTitle}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={triggerSelfCleaning}
              disabled={cleaning}
              className={`p-2 rounded-lg hover:bg-white/10 ${textSecondary} disabled:opacity-50`}
              title="Clean and deduplicate database"
            >
              {cleaning ? (
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-300" />
              ) : (
                <Sparkles className="w-4 h-4 text-emerald-400" />
              )}
            </button>
            <button
              type="button"
              onClick={syncPendingToSupabase}
              disabled={syncing}
              className={`p-2 rounded-lg hover:bg-white/10 ${textSecondary} disabled:opacity-50`}
              title="Sync pending items to Supabase"
            >
              {syncing ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-300" />
              ) : (
                <UploadCloud className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (tab === 'catalog') {
                  loadCatalog();
                } else {
                  load();
                }
              }}
              disabled={tab === 'catalog' ? catalogLoading : loading}
              className={`p-2 rounded-lg hover:bg-white/10 ${textSecondary}`}
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${(tab === 'catalog' ? catalogLoading : loading) ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className={`p-2 rounded-lg hover:bg-white/10 ${textMuted}`}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 flex gap-1 overflow-x-auto border-b border-white/10">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-indigo-400 text-white'
                  : 'border-transparent text-white/60 hover:text-white'
              }`}
            >
              {t.label}
              {typeof t.count === 'number' ? ` (${t.count})` : ''}
            </button>
          ))}
        </div>

        <div className={`flex-1 overflow-y-auto p-4 text-left text-sm ${textPrimary}`}>
          {error && (
            <div className="mb-3 p-3 rounded-xl bg-rose-600 text-white text-xs font-semibold">{error}</div>
          )}
          {syncBanner && (
            <div className="mb-3 p-3 rounded-xl bg-indigo-600/80 text-white text-xs font-semibold">{syncBanner}</div>
          )}
          {cleanDuplicates.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-amber-950/50 border border-amber-500/30 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">{cleanDuplicates.length} duplicate group(s) merged</span>
                <button type="button" onClick={() => setCleanDuplicates([])} className="text-white/40 hover:text-white text-[10px]">{t.browserDismiss}</button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {cleanDuplicates.map((d, i) => (
                  <div key={i} className="text-[10px] text-white/70 flex items-center gap-1.5">
                    <span className="text-amber-400 font-mono">{d.chain_key}</span>
                    <span className="text-white/50">·</span>
                    <span className="truncate">{d.dish_name}</span>
                    <span className="text-rose-400 ml-auto shrink-0">–{d.removed} removed</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading && !data && <p className={`text-xs ${textMuted}`}>{t.browserLoading}</p>}



          {tab === 'chains' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder={t.browserSearchMenu}
                className={`${inputCls} w-full`}
                value={globalSearch}
                onChange={(e) => runGlobalSearch(e.target.value)}
              />

              {globalSearch.trim() && (
                <div className="space-y-1.5 mb-3">
                  {globalSearchLoading && <p className={`text-[10px] ${textMuted}`}>{t.browserSearching}</p>}
                  {!globalSearchLoading && (globalSearchResults?.length || 0) === 0 && (
                    <p className={`text-[10px] ${textMuted}`}>{t.browserNoMatch}</p>
                  )}
                  {globalSearchResults?.map((item: any) => {
                    const itemKey = `${item.chain_key}:${item.dish_name_key}`;
                    const isEditing = editingItemId === itemKey || editingItemId === item.dish_name_key;

                    if (isEditing) {
                      return (
                        <div key={itemKey} className="text-[10px] bg-slate-950/80 p-2.5 rounded-lg border border-indigo-500/50 space-y-2">
                          <div className="space-y-1">
                            <label className="text-[9px] text-white/50 block font-bold">DISH NAME ({item.chain_key})</label>
                            <input
                              type="text"
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                              value={editForm.dish_name}
                              onChange={(e) => setEditForm({ ...editForm, dish_name: e.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserKcal}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.calories}
                                onChange={(e) => setEditForm({ ...editForm, calories: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserProt}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.protein}
                                onChange={(e) => setEditForm({ ...editForm, protein: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserCarb}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.carbohydrates}
                                onChange={(e) => setEditForm({ ...editForm, carbohydrates: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserFat}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.totalFat}
                                onChange={(e) => setEditForm({ ...editForm, totalFat: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserSatFat}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.saturatedFat}
                                onChange={(e) => setEditForm({ ...editForm, saturatedFat: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserSugar}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.sugar}
                                onChange={(e) => setEditForm({ ...editForm, sugar: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserFiber}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.totalFibre}
                                onChange={(e) => setEditForm({ ...editForm, totalFibre: e.target.value })}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-[8px] text-white/50 block">{t.browserSalt}</label>
                              <input
                                type="number"
                                step="0.1"
                                className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                value={editForm.salt}
                                onChange={(e) => {
                                  const s = e.target.value;
                                  const sod = s !== '' ? Math.round(Number(s) * 400) : '';
                                  setEditForm({ ...editForm, salt: s, sodium: sod });
                                }}
                              />
                            </div>
                          </div>
                                                    <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                            <div className="space-y-1">
                              <label className="text-[9px] text-white/50 block font-bold">{t.browserServingBasis}</label>
                              <select
                                className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                                value={editForm.basis_type}
                                onChange={(e) => setEditForm({ ...editForm, basis_type: e.target.value })}
                              >
                                <option value="per_dish">{t.browserOptPerDish}</option>
                                <option value="per_100g">{t.browserOptPer100}</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] text-white/50 block font-bold">{t.browserServingSize}</label>
                              <input
                                type="number"
                                className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white font-mono"
                                placeholder={t.browserServingOptional}
                                value={editForm.serving_grams}
                                onChange={(e) => setEditForm({ ...editForm, serving_grams: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] text-white/50 block font-bold">{t.browserDescription}</label>
                            <input
                              type="text"
                              className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                              value={editForm.notes}
                              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] text-white/50 block font-bold">Image URL / Photo</label>
                            <div className="flex items-center gap-2">
                              {editForm.image_url ? (
                                <img
                                  src={editForm.image_url}
                                  alt="Brand preview"
                                  className="w-7 h-7 rounded object-cover border border-white/20 shrink-0"
                                />
                              ) : null}
                              <input
                                type="text"
                                placeholder="https://... or /photos/..."
                                className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white font-mono"
                                value={editForm.image_url || ''}
                                onChange={(e) => setEditForm({ ...editForm, image_url: e.target.value })}
                              />
                              <label className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer text-[9px] font-bold shrink-0">
                                Upload
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = async () => {
                                      const b64 = reader.result as string;
                                      try {
                                        const res = await fetch('/api/r2/upload-photo', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ payload: b64, id: `brand_${Date.now()}` })
                                        });
                                        const data = await res.json();
                                        if (data.url || data.proxyUrl) {
                                          setEditForm((prev: any) => ({ ...prev, image_url: data.url || data.proxyUrl }));
                                        }
                                      } catch (upErr) {
                                        console.error('Failed to upload brand image', upErr);
                                      }
                                    };
                                    reader.readAsDataURL(file);
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => openMealLinkPicker(item)}
                                className="px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded text-[9px] font-bold shrink-0 flex items-center gap-1"
                                title="Link photo and nutrients from a logged meal"
                              >
                                <Link2 className="w-3 h-3" />
                                Link Meal
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-1.5 justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingItemId(null)}
                              className="px-2 py-1 rounded bg-white/15 hover:bg-white/25 text-[9px] font-bold text-white"
                            >
                              {t.cancel}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEdit(item)}
                              disabled={busy}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-[9px] font-bold text-white flex items-center gap-1"
                            >
                              {busy && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                              {t.save}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={itemKey}
                        className="text-[10px] bg-black/25 p-2 rounded-lg flex flex-col items-stretch gap-2 border border-white/5 hover:border-white/20 transition-all cursor-pointer group"
                        onClick={() => {
                          setEditingItemId(itemKey);
                          setEditForm({
                            dish_name: item.dish_name || '',
                            calories: item.nutrients?.calories ?? '',
                            protein: item.nutrients?.protein ?? '',
                            carbohydrates: item.nutrients?.carbohydrates ?? '',
                            totalFat: item.nutrients?.totalFat ?? '',
                            saturatedFat: item.nutrients?.saturatedFat ?? '',
                            sugar: item.nutrients?.sugar ?? '',
                            totalFibre: item.nutrients?.totalFibre ?? item.nutrients?.fiber ?? '',
                            salt: item.nutrients?.salt ?? (item.nutrients?.sodium ? (item.nutrients.sodium / 400).toFixed(2) : ''),
                            sodium: item.nutrients?.sodium ?? (item.nutrients?.salt ? Math.round(item.nutrients.salt * 400) : ''),
                            notes: cleanDescriptionText(item.notes || ''),
                            ingredients: cleanDescriptionText(item.ingredients || ''),
                            image_url: item.image_url || item.imageUrl || '',
                            basis_type: item.basis_type || 'per_dish',
                            serving_grams: item.serving_grams ?? ''
                          });
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-bold text-white flex items-center gap-1.5 truncate min-w-0">
                            {(item.image_url || item.imageUrl) ? (
                              <img
                                src={item.image_url || item.imageUrl}
                                alt={item.dish_name}
                                className="w-5 h-5 rounded object-cover border border-white/10 shrink-0"
                              />
                            ) : null}
                            {item._source === 'supabase' ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" aria-label={t.syncedToSupabase} />
                            ) : (
                              <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" aria-label={t.notSyncedLocalOnly} />
                            )}
                            <span className="truncate group-hover:text-indigo-300 transition-colors">{item.dish_name}</span>
                            <span className="text-white/40 font-normal">· {item.chain_key}</span>
                          </span>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => openMealLinkPicker(item)}
                              className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-violet-300 disabled:opacity-30"
                              title="Link photo & nutrients from logged meal"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy || deletingItemId === itemKey || deletingItemId === item.dish_name_key}
                              onClick={() => {
                                setEditingItemId(itemKey);
                                setEditForm({
                                  dish_name: item.dish_name || '',
                                  calories: item.nutrients?.calories ?? '',
                                  protein: item.nutrients?.protein ?? '',
                                  carbohydrates: item.nutrients?.carbohydrates ?? '',
                                  totalFat: item.nutrients?.totalFat ?? '',
                                  saturatedFat: item.nutrients?.saturatedFat ?? '',
                                  sugar: item.nutrients?.sugar ?? '',
                                  totalFibre: item.nutrients?.totalFibre ?? item.nutrients?.fiber ?? '',
                                  salt: item.nutrients?.salt ?? (item.nutrients?.sodium ? (item.nutrients.sodium / 400).toFixed(2) : ''),
                                  sodium: item.nutrients?.sodium ?? (item.nutrients?.salt ? Math.round(item.nutrients.salt * 400) : ''),
                                  notes: cleanDescriptionText(item.notes || ''),
                                  ingredients: cleanDescriptionText(item.ingredients || ''),
                                  basis_type: item.basis_type || 'per_dish',
                                  serving_grams: item.serving_grams ?? ''
                                });
                              }}
                              className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-white disabled:opacity-30"
                              title={t.editItem}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy || deletingItemId === itemKey || deletingItemId === item.dish_name_key}
                              onClick={(e) => deleteItem(item, e)}
                              className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${
                                deletingItemId === itemKey || deletingItemId === item.dish_name_key
                                  ? 'bg-rose-600 text-white cursor-wait font-bold'
                                  : confirmDeleteId === itemKey || confirmDeleteId === item.dish_name_key
                                  ? 'bg-rose-500 text-white'
                                  : 'hover:bg-rose-500/25 text-rose-300 hover:text-rose-200'
                              } disabled:opacity-50`}
                              title="Delete item"
                            >
                              {deletingItemId === itemKey || deletingItemId === item.dish_name_key ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                                  <span className="text-[10px] font-bold">Deleting...</span>
                                </>
                              ) : (
                                <>
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                  {(confirmDeleteId === itemKey || confirmDeleteId === item.dish_name_key) && (
                                    <span className="text-[10px] font-bold">Confirm?</span>
                                  )}
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="mt-1 -mx-2">
                          <ComprehensiveNutrientsTable 
                            nutrients={item.nutrients || {}} 
                            basisType={item.basis_type} 
                            servingGrams={item.serving_grams} 
                            onServingSizeChange={async (basisType, servingGrams) => {
                              try {
                                setBusy(true);
                                const res = await fetch('/api/brand-menu-items/edit', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    country_code: item.country_code || 'GB',
                                    chain_key: item.chain_key,
                                    dish_name_key: item.dish_name_key,
                                    dish_name: item.dish_name,
                                    serving_grams: servingGrams,
                                    basis_type: basisType,
                                    nutrients: item.nutrients,
                                    ingredients: item.ingredients
                                  })
                                });
                                if (!res.ok) throw new Error("Failed to update serving size");
                                if (item.chain_key) {
                                  await loadChainItems(item.chain_key);
                                }
                                if (globalSearch.trim()) {
                                  await runGlobalSearch(globalSearch);
                                }
                              } catch (err: any) {
                                alert(err.message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                        </div>
                        {item.ingredients && (
                          <span className="text-white/40 text-[8px] italic block truncate px-1">
                            {cleanDescriptionText(item.ingredients)}
                          </span>
                        )}
                        {item.notes && !item.ingredients && (
                          <span className="text-white/40 text-[8px] italic block truncate px-1">
                            {cleanDescriptionText(item.notes)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {globalSearch.trim() && <div className="border-t border-white/10 pt-2" />}
              {(() => {
                const rawSources = data?.chainSources || [];
                const uniqueSourcesMap = new Map<string, any>();
                for (const s of rawSources) {
                  const k = (s.chain_key || s.display_name || '').toLowerCase();
                  if (!k) continue;
                  if (!uniqueSourcesMap.has(k)) {
                    uniqueSourcesMap.set(k, s);
                  }
                }
                const chainSourcesList = Array.from(uniqueSourcesMap.values());

                if (chainSourcesList.length === 0) {
                  return <p className={`text-xs ${textMuted}`}>{t.browserNoChains}</p>;
                }

                return <>{chainSourcesList.map((s: any) => {
                  const key = s.chain_key;
                  const isExpanded = !!expandedChains[key];
                  return (
                    <div key={key || s.id} className="p-3 space-y-1.5 text-white transition-all">
                      {editingChainId === s.id ? (
                      <div className="space-y-3 text-left animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[9px] text-white/50 block font-bold">RESTAURANT NAME</label>
                            <input
                              type="text"
                              className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                              value={editChainForm.display_name}
                              onChange={(e) => setEditChainForm({ ...editChainForm, display_name: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] text-white/50 block font-bold">CHAIN KEY / SLUG</label>
                            <input
                              type="text"
                              disabled
                              className="w-full bg-slate-950/80 border border-white/5 rounded px-2.5 py-1.5 text-xs text-white/50 cursor-not-allowed"
                              value={editChainForm.chain_key}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
<label className="text-[9px] text-white/50 block font-bold">{t.browserMenuUrl}</label>
                          <input
                            type="text"
                            className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                            value={editChainForm.url}
                            onChange={(e) => setEditChainForm({ ...editChainForm, url: e.target.value })}
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingChainId(null)}
                            className="text-[10px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white"
                          >
                            {t.cancel}
                          </button>
                          <button
                            type="button"
                            onClick={saveChainSource}
                            disabled={busy}
                            className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 flex items-center gap-1"
                          >
                            {busy && <RefreshCw className="w-3 h-3 animate-spin" />}
                            {t.save}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div 
                          className="flex items-center justify-between gap-2 cursor-pointer select-none"
                          onClick={() => toggleChainExpand(key)}
                        >
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className={`font-bold truncate ${textPrimary}`}>
                              {s.display_name || key}
                              {typeof data?.chainItemCounts?.[key]?.total === 'number' && (
                                <span className="text-white/50 font-normal"> ({data.chainItemCounts[key].total})</span>
                              )}
                            </span>
                            {key.toLowerCase() !== (s.display_name || '').toLowerCase() && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 font-mono text-white">
                                {key}
                              </span>
                            )}
                            {(data?.chainItemCounts?.[key]?.pending || 0) > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {data.chainItemCounts[key].pending} pending sync
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingChainId(s.id);
                                setEditChainForm({
                                  id: s.id,
                                  chain_key: key,
                                  display_name: s.display_name || key,
                                  url: s.url || ''
                                });
                              }}
                              className="p-1 rounded hover:bg-white/10 text-white/75"
                              title="Edit Branded Food / Restaurant"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy || deletingChainId === (s.id || key)}
                              onClick={(e) => deleteChainSource(s, e)}
                              className={`px-1.5 py-1 flex items-center gap-1 rounded transition-colors ${
                                deletingChainId === (s.id || key)
                                  ? 'bg-rose-600 text-white cursor-wait font-bold'
                                  : confirmDeleteChainId === (s.id || key)
                                  ? 'bg-rose-500 text-white font-bold'
                                  : 'hover:bg-rose-500/25 text-rose-300 hover:text-rose-200'
                              } disabled:opacity-50`}
                              title="Delete brand and all associated menu items"
                            >
                              {deletingChainId === (s.id || key) ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                                  <span className="text-[10px] font-bold">Deleting...</span>
                                </>
                              ) : (
                                <>
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                  {confirmDeleteChainId === (s.id || key) && (
                                    <span className="text-[10px] font-bold">Confirm?</span>
                                  )}
                                </>
                              )}
                            </button>
                            <button type="button" className="p-1 rounded hover:bg-white/10 text-white/75" onClick={() => toggleChainExpand(key)}>
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="text-[11px] text-sky-300 truncate">
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all underline"
                            >
                              {s.url}
                            </a>
                          </div>
                        )}
                      </>
                    )}

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-3 text-left">
                        <div className="space-y-1.5">
                          {(!chainItems[key] || chainItems[key].length === 0) && (
                            <p className={`text-[10px] ${textMuted}`}>{t.browserNoItems}</p>
                          )}
                          {(chainItems[key] || []).map((item: any) => {
                            const isEditing = editingItemId === item.dish_name_key;
                            if (isEditing) {
                              return (
                                <div key={item.dish_name_key || item.id} className="text-[10px] bg-slate-950/80 p-2.5 rounded-lg border border-indigo-500/50 space-y-2">
                                  <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                                    <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">✏️ Edit Branded Food Item</span>
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setEditingItemId(null)}
                                        className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[9px] font-bold text-white"
                                      >
                                        {t.cancel}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => saveEdit(item)}
                                        disabled={busy}
                                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[9px] font-bold text-white flex items-center gap-1"
                                      >
                                        {busy && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                                        {t.save}
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-[9px] text-white/50 block font-bold">{t.browserDishName}</label>
                                    <input
                                      type="text"
                                      className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                                      value={editForm.dish_name}
                                      onChange={(e) => setEditForm({ ...editForm, dish_name: e.target.value })}
                                    />
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserServingBasis}</label>
                                      <select
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
                                        value={editForm.basis_type}
                                        onChange={(e) => setEditForm({ ...editForm, basis_type: e.target.value })}
                                      >
                                        <option value="per_dish">Per Dish / Portion</option>
                                        <option value="per_100g">Per 100g</option>
                                      </select>
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserServingSize}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.serving_grams}
                                        onChange={(e) => setEditForm({ ...editForm, serving_grams: e.target.value })}
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserKcal}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.calories}
                                        onChange={(e) => setEditForm({ ...editForm, calories: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserProt}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.protein}
                                        onChange={(e) => setEditForm({ ...editForm, protein: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserCarb}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.carbohydrates}
                                        onChange={(e) => setEditForm({ ...editForm, carbohydrates: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserFat}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.totalFat}
                                        onChange={(e) => setEditForm({ ...editForm, totalFat: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserSatFat}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.saturatedFat}
                                        onChange={(e) => setEditForm({ ...editForm, saturatedFat: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserSugar}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.sugar}
                                        onChange={(e) => setEditForm({ ...editForm, sugar: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserFiber}</label>
                                      <input
                                        type="number"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.totalFibre}
                                        onChange={(e) => setEditForm({ ...editForm, totalFibre: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <label className="text-[8px] text-white/50 block">{t.browserSalt}</label>
                                      <input
                                        type="number"
                                        step="0.1"
                                        className="w-full bg-slate-900 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white font-mono"
                                        value={editForm.salt}
                                        onChange={(e) => {
                                          const s = e.target.value;
                                          const sod = s !== '' ? Math.round(Number(s) * 400) : '';
                                          setEditForm({ ...editForm, salt: s, sodium: sod });
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] text-white/50 block font-bold">{t.browserDescription}</label>
                                    <input
                                      type="text"
                                      className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                                      value={editForm.ingredients}
                                      onChange={(e) => setEditForm({ ...editForm, ingredients: e.target.value })}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] text-white/50 block font-bold">Image URL / Photo</label>
                                    <div className="flex items-center gap-2">
                                      {editForm.image_url ? (
                                        <img
                                          src={editForm.image_url}
                                          alt="Brand preview"
                                          className="w-7 h-7 rounded object-cover border border-white/20 shrink-0"
                                        />
                                      ) : null}
                                      <input
                                        type="text"
                                        placeholder="https://... or /photos/..."
                                        className="flex-1 bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white font-mono"
                                        value={editForm.image_url || ''}
                                        onChange={(e) => setEditForm({ ...editForm, image_url: e.target.value })}
                                      />
                                      <label className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer text-[9px] font-bold shrink-0">
                                        Upload
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = async () => {
                                              const b64 = reader.result as string;
                                              try {
                                                const res = await fetch('/api/r2/upload-photo', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ payload: b64, id: `brand_${Date.now()}` })
                                                });
                                                const data = await res.json();
                                                if (data.url || data.proxyUrl) {
                                                  setEditForm((prev: any) => ({ ...prev, image_url: data.url || data.proxyUrl }));
                                                }
                                              } catch (upErr) {
                                                console.error('Failed to upload brand image', upErr);
                                              }
                                            };
                                            reader.readAsDataURL(file);
                                          }}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() => openMealLinkPicker(item)}
                                        className="px-2 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded text-[9px] font-bold shrink-0 flex items-center gap-1"
                                        title="Link photo and nutrients from a logged meal"
                                      >
                                        <Link2 className="w-3 h-3" />
                                        Link Meal
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={item.dish_name_key || item.id} className="text-[10px] bg-black/25 p-2 rounded-lg flex flex-col items-stretch gap-2 border border-white/5 hover:border-white/15 transition-all">
                                <div className="flex items-center justify-between gap-2 min-w-0">
                                  <span className="font-bold text-white flex items-center gap-1.5 truncate min-w-0">
                                    {(item.image_url || item.imageUrl) ? (
                                      <img
                                        src={item.image_url || item.imageUrl}
                                        alt={item.dish_name}
                                        className="w-5 h-5 rounded object-cover border border-white/10 shrink-0"
                                      />
                                    ) : null}
                                    {item._source === 'supabase' ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" aria-label={t.syncedToSupabase} />
                                    ) : (
                                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" aria-label={t.notSyncedLocalMayBeLost} />
                                    )}
                                    <span className="truncate">{item.dish_name}</span>
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => openMealLinkPicker(item)}
                                      className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-violet-300 disabled:opacity-30"
                                      title="Link photo & nutrients from logged meal"
                                    >
                                      <Link2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy || deletingItemId === item.dish_name_key || deletingItemId === `${key}:${item.dish_name_key}`}
                                      onClick={() => {
                                        setEditingItemId(item.dish_name_key);
                                        setEditForm({
                                          dish_name: item.dish_name || '',
                                          calories: item.nutrients?.calories ?? '',
                                          protein: item.nutrients?.protein ?? '',
                                          carbohydrates: item.nutrients?.carbohydrates ?? '',
                                          totalFat: item.nutrients?.totalFat ?? '',
                                          saturatedFat: item.nutrients?.saturatedFat ?? '',
                                          sugar: item.nutrients?.sugar ?? '',
                                          totalFibre: item.nutrients?.totalFibre ?? item.nutrients?.fiber ?? '',
                                          salt: item.nutrients?.salt ?? (item.nutrients?.sodium ? (item.nutrients.sodium / 400).toFixed(2) : ''),
                                          sodium: item.nutrients?.sodium ?? (item.nutrients?.salt ? Math.round(item.nutrients.salt * 400) : ''),
                                          notes: cleanDescriptionText(item.notes || ''),
                                          ingredients: cleanDescriptionText(item.ingredients || ''),
                                          image_url: item.image_url || item.imageUrl || '',
                                          basis_type: item.basis_type || 'per_dish',
                                          serving_grams: item.serving_grams ?? ''
                                        });
                                      }}
                                      className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-white disabled:opacity-30"
                                      title={t.editItem}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy || deletingItemId === item.dish_name_key || deletingItemId === `${key}:${item.dish_name_key}`}
                                      onClick={(e) => deleteItem(item, e)}
                                      className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${
                                        deletingItemId === item.dish_name_key || deletingItemId === `${key}:${item.dish_name_key}`
                                          ? 'bg-rose-600 text-white cursor-wait font-bold'
                                          : confirmDeleteId === item.dish_name_key || confirmDeleteId === `${key}:${item.dish_name_key}`
                                          ? 'bg-rose-500 text-white'
                                          : 'hover:bg-rose-500/25 text-rose-300 hover:text-rose-200'
                                      } disabled:opacity-50`}
                                      title="Delete item"
                                    >
                                      {deletingItemId === item.dish_name_key || deletingItemId === `${key}:${item.dish_name_key}` ? (
                                        <>
                                          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                                          <span className="text-[10px] font-bold">Deleting...</span>
                                        </>
                                      ) : (
                                        <>
                                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                          {(confirmDeleteId === item.dish_name_key || confirmDeleteId === `${key}:${item.dish_name_key}`) && (
                                            <span className="text-[10px] font-bold">Confirm?</span>
                                          )}
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>

                                <div className="mt-1 -mx-2">
                                  <ComprehensiveNutrientsTable 
                                    nutrients={item.nutrients || {}} 
                                    basisType={item.basis_type} 
                                    servingGrams={item.serving_grams} 
                                    onServingSizeChange={async (basisType, servingGrams) => {
                                      try {
                                        setBusy(true);
                                        const res = await fetch('/api/brand-menu-items/edit', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            country_code: item.country_code || 'GB',
                                            chain_key: item.chain_key,
                                            dish_name_key: item.dish_name_key,
                                            dish_name: item.dish_name,
                                            serving_grams: servingGrams,
                                            basis_type: basisType,
                                            nutrients: item.nutrients,
                                            ingredients: item.ingredients
                                          })
                                        });
                                        if (!res.ok) throw new Error("Failed to update serving size");
                                        if (item.chain_key) {
                                          await loadChainItems(item.chain_key);
                                        }
                                        if (globalSearch.trim()) {
                                          await runGlobalSearch(globalSearch);
                                        }
                                      } catch (err: any) {
                                        alert(err.message);
                                      } finally {
                                        setBusy(false);
                                      }
                                    }}
                                  />
                                </div>
                                {item.ingredients && (
                                  <span className="text-white/40 text-[8px] italic block truncate px-1">
                                    {cleanDescriptionText(item.ingredients)}
                                  </span>
                                )}
                                {item.notes && !item.ingredients && (
                                  <span className="text-white/40 text-[8px] italic block truncate px-1">
                                    {cleanDescriptionText(item.notes)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div className="rounded-xl border border-emerald-400/40 bg-emerald-950/30 p-2.5 space-y-2">
                          <p className={`text-[11px] font-bold flex items-center gap-1 ${textPrimary}`}>
                            <ClipboardPaste className="w-3.5 h-3.5" /> {t.browserPasteTitle}
                          </p>
                          <textarea
                            className={`${inputCls} w-full min-h-[120px] font-mono text-[10px]`}
                            placeholder={t.browserPastePlaceholder}
                            value={pasteDrafts[key] || ''}
                            onChange={(e) =>
                              setPasteDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          {pastePreview[key] && (
                            <div className={`text-[10px] rounded-lg bg-black/30 p-2.5 space-y-1.5 ${textSecondary}`}>
                              <div>
                                <span className="font-bold text-emerald-300">{t.browserPreviewLabel}</span>
                                <span className="font-semibold text-white">{pastePreview[key].dish_name || t.browserNoDishName}</span>
                                {pastePreview[key].description && (
                                  <span className="text-white/60"> — {pastePreview[key].description}</span>
                                )}
                              </div>
                              <div className="font-mono text-white/90">
                                {renderNutrientSummaryLine(pastePreview[key].nutrients)}
                              </div>
                              <div className="mt-1">
                                <ComprehensiveNutrientsTable 
                                  nutrients={pastePreview[key].nutrients || {}} 
                                  basisType={pastePreview[key].basis_type} 
                                  servingGrams={pastePreview[key].serving_grams} 
                                />
                              </div>
                              {pastePreview[key].warnings?.length > 0 && (
                                <div className="text-amber-300 text-[9px] flex items-start gap-1">
                                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>{t.browserWarningsLabel}{pastePreview[key].warnings.join(', ')}</span>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy || !(pasteDrafts[key] || '').trim()}
                              onClick={() => {
                                const local = parseMenuNutritionPaste(pasteDrafts[key] || '');
                                setPastePreview((prev) => ({ ...prev, [key]: local }));
                              }}
                              className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/25 text-white disabled:opacity-40"
                            >
                              {t.browserPreviewBtn}
                            </button>
                            <button
                              type="button"
                              disabled={busy || !(pasteDrafts[key] || '').trim()}
                              onClick={() => pasteAndSave(key)}
                              className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 flex items-center gap-1"
                            >
                              {busy && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
                              {busy ? t.browserSavingBtn : t.browserPasteAddBtn}
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-sky-400/40 bg-sky-950/30 p-2.5 space-y-2">
                          <p className={`text-[11px] font-bold flex items-center gap-1 ${textPrimary}`}>
                            <ClipboardPaste className="w-3.5 h-3.5" /> {t.browserBulkTitle}
                          </p>
                          <textarea
                            className={`${inputCls} w-full min-h-[160px] font-mono text-[10px]`}
                            placeholder={t.browserBulkPlaceholder}
                            value={bulkDrafts[key] || ''}
                            onChange={(e) =>
                              setBulkDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          {bulkPreview[key] && (
                            <div className={`text-[10px] rounded-lg bg-black/30 p-2.5 space-y-1 ${textSecondary}`}>
                              <span className="font-bold text-sky-300">
                                {interpolate(t.browserBulkDetected, { n: bulkPreview[key].dishes.length })}
                              </span>
                              {bulkPreview[key].dishes.map((d: any, i: number) => (
                                <div key={i} className="font-mono text-white/80 truncate">
                                  {d.dish_name} — {d.nutrients?.calories ?? '—'} kcal
                                  {(!d.nutrients?.protein && !d.nutrients?.totalFat) ? t.browserBulkCalOnly : ''}
                                </div>
                              ))}
                            </div>
                          )}
                          {bulkResults[key] && (
                            <div className={`text-[10px] rounded-lg bg-black/30 p-2.5 space-y-1 ${textSecondary}`}>
                              <span className="font-bold text-emerald-300">
                                  {interpolate(t.browserBulkSaved, { saved: bulkResults[key].summary.savedToSupabase + bulkResults[key].summary.savedLocalOnly, total: bulkResults[key].summary.total })}
                              </span>
                              {bulkResults[key].summary.savedLocalOnly > 0 && (
                                <div className="text-amber-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  {interpolate(t.browserBulkLocalOnly, { n: bulkResults[key].summary.savedLocalOnly })}
                                </div>
                              )}
                              {bulkResults[key].summary.errors > 0 && (
                                <div className="text-rose-300">{interpolate(t.browserBulkFailed, { n: bulkResults[key].summary.errors })}</div>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy || !(bulkDrafts[key] || '').trim()}
                              onClick={() => {
                                const local = parseMenuNutritionBulkPaste(bulkDrafts[key] || '');
                                setBulkPreview((prev) => ({ ...prev, [key]: local }));
                              }}
                              className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/25 text-white disabled:opacity-40"
                            >
                              {t.browserPreviewBtn}
                            </button>
                            <button
                              type="button"
                              disabled={busy || !(bulkDrafts[key] || '').trim()}
                              onClick={() => bulkPasteAndSave(key)}
                              className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 flex items-center gap-1"
                            >
                              {busy && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
                              {busy ? t.browserSavingBtn : t.browserBulkAddAll}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}</>;
              })()}

              {showAddChain && (
                <div className="border border-indigo-500/30 rounded-xl p-3 bg-slate-950/40 space-y-3 mb-3 text-left">
                  <h3 className="text-xs font-bold text-indigo-300">{t.browserAddSourceTitle}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] text-white/50 block font-bold">{t.browserBrandName}</label>
                      <input
                        type="text"
                        className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                        placeholder={t.browserBrandNamePh}
                        value={addChainForm.display_name}
                        onChange={(e) => setAddChainForm({ ...addChainForm, display_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-white/50 block font-bold">{t.browserChainKey}</label>
                      <input
                        type="text"
                        className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                        placeholder={t.browserChainKeyPh}
                        value={addChainForm.chain_key}
                        onChange={(e) => setAddChainForm({ ...addChainForm, chain_key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/50 block font-bold">MENU URL / SOURCE LINK</label>
                    <input
                      type="text"
                      className="w-full bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                      placeholder="https://..."
                      value={addChainForm.url}
                      onChange={(e) => setAddChainForm({ ...addChainForm, url: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddChain(false)}
                      className="text-[10px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white"
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={saveNewChainSource}
                      disabled={busy}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 flex items-center gap-1"
                    >
                      {busy && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {t.browserAddSourceBtn}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAddChain(!showAddChain)}
                className="w-full text-xs font-bold px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.browserAddBrandedBtn}
              </button>
            </div>
          )}

          {tab === 'catalog' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <select 
                  className={inputCls}
                  value={catalogType}
                  onChange={(e) => setCatalogType(e.target.value as any)}
                >
                  <option value="food">{t.browserOptFood}</option>
                  <option value="dish">{t.browserOptDish}</option>
                </select>
                <select 
                  className={inputCls}
                  value={catalogStatus}
                  onChange={(e) => setCatalogStatus(e.target.value as any)}
                >
                  <option value="all">{t.browserOptAll}</option>
                  <option value="active">{t.browserOptActive}</option>
                  <option value="candidate">{t.browserOptCandidate}</option>
                  <option value="quarantine">{t.browserOptQuarantine}</option>
                </select>
                <div className="flex gap-1 flex-1 min-w-[200px]">
                  <input
                    type="text"
                    className={`${inputCls} flex-1`}
                    placeholder={t.browserSearchCatalog}
                    value={catalogSearch}
                    onChange={(e) => {
                      setCatalogSearch(e.target.value);
                      loadCatalog(e.target.value);
                    }}
                  />
                </div>
              </div>

              {catalogError && (
                <div className="p-3 bg-rose-950/40 border border-rose-900/50 rounded-xl text-rose-400 text-xs">
                  {catalogError.includes('relation "food_items" does not exist') || catalogError.includes('relation "dishes" does not exist') ?
                    t.browserCatalogMigrate : catalogError}
                </div>
              )}

              <div className="text-xs text-white/60">
                {interpolate(t.browserCatalogSaved, { n: catalogItems.length, type: catalogType === 'food' ? t.browserOptFood : t.browserOptDish })}
              </div>

              {catalogItems.length === 0 && !catalogLoading && !catalogError && (
                <div className="p-4 text-center text-white/40 text-sm border border-white/5 rounded-xl border-dashed">
                  {t.browserCatalogEmpty}
                </div>
              )}

              {catalogItems.length > 0 && (
                <div className="space-y-2">
                  {catalogItems.map((item) => {
                    const key = item.food_key || item.dish_key || item.id;
                    const isSelected = selectedCatalogKey === key;
                    const nutrients = item.nutrients_per_100g || item.core_nutrients || {};
                    return (
                      <div key={key} className="p-3 space-y-1.5 text-white transition-all">
                        <div 
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => setSelectedCatalogKey(isSelected ? null : key)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold truncate">{item.display_name || key}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono border ${
                                item.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                item.status === 'candidate' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              }`}>
                                {item.status || 'unknown'}
                              </span>
                            </div>
                            <div className="text-[10px] text-white/50 mt-1">
                              
                            </div>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                        </div>
                        {isSelected && (
                          <div className="pt-3 mt-3 border-t border-white/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div><span className="text-white/40 block">Key</span><span className="font-mono text-[10px] break-all">{key}</span></div>
                              {item.provenance && <div><span className="text-white/40 block">Provenance</span><span>{item.provenance}</span></div>}
                              {item.confidence && <div><span className="text-white/40 block">Confidence</span><span>{item.confidence}</span></div>}
                              {item.capture_count !== undefined && <div><span className="text-white/40 block">Captures</span><span>{item.capture_count}</span></div>}
                              {item.serving_grams && <div><span className="text-white/40 block">Serving</span><span>{item.serving_grams}g</span></div>}
                            </div>
                            
                            {item.form_tags && item.form_tags.length > 0 && (
                              <div>
                                <span className="text-white/40 text-[10px] uppercase block mb-1">Tags</span>
                                <div className="flex flex-wrap gap-1">
                                  {item.form_tags.map((t: string) => (
                                    <span key={t} className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] text-white/70">{t}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="-mx-3">
                              <ComprehensiveNutrientsTable 
                                nutrients={item.nutrients_per_100g || item.core_nutrients || {}} 
                                basisType={item.basis_type || 'per_100g'} 
                                servingGrams={item.serving_grams} 
                                onServingSizeChange={async (basisType, servingGrams) => {
                                  try {
                                    setBusy(true);
                                    let finalBasis = basisType;
                                    if (!finalBasis || finalBasis.trim() === '') {
                                      const def = defaultServingSizeFor('catalog');
                                      finalBasis = def.basisType;
                                      setSyncBanner(interpolate(t.browserServingDefaulted, { label: def.label }));
                                      setTimeout(() => setSyncBanner(null), 5000);
                                    }

                                    const res = await fetch('/api/admin/food-catalog/update-serving', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        itemType: catalogType,
                                        key: key,
                                        basisType: finalBasis,
                                        servingGrams: servingGrams
                                      })
                                    });
                                    if (!res.ok) throw new Error("Failed to update catalog item serving size");
                                    await loadCatalog(catalogSearch);
                                  } catch (err: any) {
                                    alert(err.message || String(err));
                                  } finally {
                                    setBusy(false);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'unfetched' && (
            <div className="space-y-2">
              <p className={`text-xs mb-2 flex items-center gap-1 ${textSecondary}`}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                {t.browserUnfetchedDesc}
              </p>
              {(data?.chainNotFetched || []).map((s: any) => (
                <div key={s.id} className="border border-amber-500/50 rounded-xl p-3 bg-amber-950/50 space-y-1">
                  <p className="font-bold text-sm text-white">
                    {s.chain_key} · {s.status}
                  </p>
                  <p className="text-[11px] break-all text-white/90">{s.url}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'base' && (
            <div className="space-y-2">
              <p className={`text-xs mb-2 flex items-center gap-1 ${textSecondary}`}>
                <Leaf className="w-3.5 h-3.5 text-emerald-400" />
                {t.browserBaseDesc}
              </p>
              {(data?.baseFoodCache || []).length === 0 && (
                <p className={`text-xs ${textMuted}`}>{t.browserBaseEmpty}</p>
              )}
              {(data?.baseFoodCache || []).map((f: any) => (
                <div key={f.id} className={card}>
                  <p className={`font-bold text-sm ${textPrimary}`}>{f.name || f.query_or_id}</p>
                  <pre className={`${preBlock} mt-1 max-h-28`}>{JSON.stringify(f.nutrients, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        {showMealLinkModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in font-sans">
            <div className="bg-slate-900 border border-white/20 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-800/80">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-violet-400" />
                    Link Meal to Brand Item
                  </h3>
                  <p className="text-xs text-white/60 truncate mt-0.5">
                    Target: <span className="text-violet-300 font-semibold">{mealLinkTargetItem?.dish_name}</span> ({mealLinkTargetItem?.chain_key})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMealLinkModal(false)}
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body: list of meals */}
              <div className="p-4 overflow-y-auto space-y-3 flex-1">
                {loadingMealsWithPhotos ? (
                  <div className="flex items-center justify-center py-12 text-white/50 gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-violet-400" />
                    <span className="text-xs">Loading recent meals with photos...</span>
                  </div>
                ) : mealsWithPhotos.length === 0 ? (
                  <div className="text-center py-12 text-white/50 text-xs">
                    No recent meals with photos found in database.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[11px] text-white/70">
                      Select a meal log below to link its photo. If multiple photos exist, click the specific photo corresponding to this brand food:
                    </p>
                    {mealsWithPhotos.map((meal) => {
                      const photos: string[] = meal.imageUrls?.length > 0 ? meal.imageUrls : (meal.imageUrl ? [meal.imageUrl] : []);
                      const isSelected = selectedMealForLink?.id === meal.id;
                      return (
                        <div
                          key={meal.id}
                          onClick={() => {
                            setSelectedMealForLink(meal);
                            if (selectedMealForLink?.id !== meal.id) setSelectedPhotoIndexForLink(0);
                          }}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'border-violet-500 bg-violet-950/40 ring-1 ring-violet-500'
                              : 'border-white/10 bg-slate-800/60 hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-white truncate max-w-[300px]">{meal.name}</span>
                            <div className="flex items-center gap-2 text-[10px] text-white/50">
                              <span>{meal.date}</span>
                              {meal.calories ? <span className="text-violet-300 font-mono font-bold">{meal.calories} kcal</span> : null}
                            </div>
                          </div>

                          {/* Photos Grid */}
                          <div className="flex items-center gap-2 overflow-x-auto py-1">
                            {photos.map((pUrl, pIdx) => {
                              const isPhotoChosen = isSelected && selectedPhotoIndexForLink === pIdx;
                              return (
                                <div
                                  key={pIdx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedMealForLink(meal);
                                    setSelectedPhotoIndexForLink(pIdx);
                                  }}
                                  className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                                    isPhotoChosen
                                      ? 'border-violet-400 ring-2 ring-violet-400/50 scale-105'
                                      : 'border-white/20 hover:border-white/60 opacity-80 hover:opacity-100'
                                  }`}
                                >
                                  <img
                                    src={pUrl}
                                    alt={`Photo ${pIdx + 1}`}
                                    className="w-16 h-16 object-cover bg-black/30"
                                  />
                                  {photos.length > 1 && (
                                    <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[9px] text-center font-bold text-white py-0.5">
                                      Photo {pIdx + 1}
                                    </span>
                                  )}
                                  {isPhotoChosen && (
                                    <div className="absolute top-1 right-1 bg-violet-600 rounded-full p-0.5 text-white">
                                      <CheckCircle2 className="w-3 h-3" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer Options & Actions */}
              <div className="p-4 border-t border-white/10 bg-slate-800/80 flex flex-col gap-3">
                <label className="flex items-center gap-2 text-xs text-white/90 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyNutrientsOnLink}
                    onChange={(e) => setCopyNutrientsOnLink(e.target.checked)}
                    className="rounded border-white/20 bg-slate-900 text-violet-600 focus:ring-violet-500"
                  />
                  <span>Also copy nutrients from selected meal (calories, protein, carbs, fat, sodium)</span>
                </label>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMealLinkModal(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!selectedMealForLink || busy}
                    onClick={confirmMealLink}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 flex items-center gap-1.5 shadow-lg"
                  >
                    {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    Confirm Link
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );
}
