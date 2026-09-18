import React from 'react';
import { Utensils } from 'lucide-react';

export function FoodCatalogAdminTab() {
  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
      <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <Utensils className="w-4 h-4 text-emerald-500" />
        Food Catalog Administration
      </h4>
      <p className="text-slate-500 dark:text-slate-400">
        Browse, audit, and curate verified food and meal item definitions.
      </p>
    </div>
  );
}

export default FoodCatalogAdminTab;
