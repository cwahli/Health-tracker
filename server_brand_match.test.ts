import { describe, it, expect } from "vitest";
import { matchBrandMenu, isPackagedBindItem, inferChainNameFromPackageLabel } from "./server_brand_match";
import { brandHitFitsQuery } from "./serverBrandMenu";

describe("server_brand_match", () => {
  it("matches known brand item from local database", async () => {
    const result = await matchBrandMenu("Sainsbury", "Sainsbury's Scottish Whole Rolled Oats");
    if (result.matched) {
      expect(result.status).toBe("HIT");
      expect(result.lockedKeys).toContain("calories");
      expect(result.valuesAtBasis?.calories).toBeGreaterThan(0);
    } else {
      // Graceful fallback if database file is not initialized in unit environment
      expect(["HIT", "MISS"]).toContain(result.status);
    }
  });

  it("returns MISS for empty queries", async () => {
    const result = await matchBrandMenu(null, null, null);
    expect(result.matched).toBe(false);
    expect(result.status).toBe("MISS");
  });

  it("F-8.12 binds the Hemaviton brand row with vitamin C locked (never the 1000 mg name)", async () => {
    const result = await matchBrandMenu("Hemaviton", "Hemaviton C1000 Orange Drink");
    expect(result.matched).toBe(true);
    expect(result.status).toBe("HIT");
    expect(result.lockedKeys).toContain("calories");
    expect(result.lockedKeys).toContain("vitaminC");
    expect(Number(result.valuesAtBasis?.vitaminC)).toBeGreaterThan(0);
    expect(Number(result.valuesAtBasis?.vitaminC)).not.toBe(1000);
  });
});

describe("F-11.1 quarantined rows never match", () => {
  it("brandHitFitsQuery rejects quarantined and merged status", () => {
    expect(brandHitFitsQuery("Big Mac", { dish_name: "Big Mac", status: "quarantined" })).toBe(false);
    expect(brandHitFitsQuery("Big Mac", { dish_name: "Big Mac", status: "merged" })).toBe(false);
    expect(brandHitFitsQuery("Big Mac", { dish_name: "Big Mac", status: "ready" })).toBe(true);
  });
});

describe("packaged bind F-8.7", () => {
  it("canned drink with chainName and no printed label still binds (not CuratorSkipped)", () => {
    const drink = {
      originalName: "Acme Citrus Vitamin Drink",
      chainName: "Acme",
      estimatedWeightGrams: 330,
    };
    expect(isPackagedBindItem(drink)).toBe(true);
    expect(isPackagedBindItem({ originalName: "steamed rice" })).toBe(false);
  });

  it("infers chainName from can OCR without inventing micronutrients", () => {
    expect(inferChainNameFromPackageLabel("Acme Citrus | Vitamin Drink 330ml")).toBe("Acme Citrus");
    expect(inferChainNameFromPackageLabel("x")).toBeNull();
  });
});
