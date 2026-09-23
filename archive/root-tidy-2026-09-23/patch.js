const fs = require('fs');
let content = fs.readFileSync('server_food_analyze_run.ts', 'utf8');

const replacement = `    let dietitianResult: any = { rawParsed: null, narratorInput: null, textOutput: "" };
    if (!ctx.refineDecision.skip) {
      await executePrecalcPhase(ctx, {
        searchUSDA, searchOpenFoodFacts, fetchUSDAFoodById, fetchOFFProductByBarcode, lookupChainMenuSources: async () => [],
        searchBrandMenuItems, isKnownDatabaseBrand, isKnownDatabaseBrandSync, getBrandMenuItemById, brandHitFitsQuery, isUsableWebNutritionHit, selfCleanBrandDatabase,
        resolveInternalFood, resolveDishCache, recordFoodObservation, upsertFoodItemCandidate, upsertFoodAlias, getFallbackCategoryProfile, normalizeFoodKey, sanitizeDishTitle,
        rankAndClassifyCandidates, writeAliasIfHitUnique, executeFoodResolverCurator, injectExplicitFoodTags
      });
      dietitianResult = await executeDietitianPhase(ctx);
    }
    
    await executeFinalizePhase(ctx, dietitianResult.rawParsed, dietitianResult.narratorInput, dietitianResult.textOutput);`;

content = content.replace(/    if \(\!ctx\.refineDecision\.skip\) \{\s+await executePrecalcPhase\(ctx\);\s+await executeDietitianPhase\(ctx\);\s+\}\s+await executeFinalizePhase\(ctx\);/g, replacement);

fs.writeFileSync('server_food_analyze_run.ts', content);
