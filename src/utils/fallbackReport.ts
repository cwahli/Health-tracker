import { UserProfile, RecommendationReport } from '../types';

export function getLocalFallbackReport(profile: UserProfile | null): RecommendationReport {
  const email = profile?.email?.toLowerCase() || '';
  const isSpecialUser = email === 'chiwah.liu@gmail.com' || email === 'cwah.liu@gmail.com';

  if (isSpecialUser) {
    return {
      timestamp: new Date().toISOString(),
      dailyNutrientTargets: {
        calories: "1,700–1,800 kcal",
        protein: "90–100 g (protects kidneys)",
        totalFat: "55–65 g",
        saturatedFat: "under 15 g (critical for LDL)",
        unsaturatedFat: "35–45 g",
        omega3: "2.5–3 g",
        carbohydrates: "160–185 g (low GI)",
        addedSugar: "under 20 g",
        totalFibre: "35–40 g",
        solubleFibre: "10–15 g (critical for LDL)",
        sodium: "under 1,200 mg (kidney + BP protection)",
        potassium: "3,500–4,000 mg",
        magnesium: "400–420 mg",
        calcium: "1,000 mg",
        iron: "8 mg",
        zinc: "11 mg",
        selenium: "55 mcg",
        iodine: "150 mcg",
        phosphorus: "700 mg",
        vitaminD: "2,000 IU (East Asians commonly deficient)",
        vitaminB12: "2.4 mcg",
        folate: "400 mcg",
        vitaminC: "90 mg",
        vitaminE: "15 mg",
        vitaminK: "120 mcg",
        vitaminA: "900 mcg",
        vitaminB6: "1.7 mg",
        thiamine: "1.2 mg",
        riboflavin: "1.3 mg",
        niacin: "16 mg"
      },
      mostImportantNextStep: "See GP urgently about statin — rosuvastatin 5mg is the evidence-based starting point for East Asian men with your high LDL, HbA1c, and declining kidney filtration.",
      actions: [
        {
          id: "act_1",
          task: "Consult GP about Low-Dose Statin prescription (e.g. Rosuvastatin 5mg)",
          explanation: "Given your elevated LDL-C and East Asian genetics, a low-dose statin is the most evidence-based starting point.",
          priority: "high",
          completed: false,
          type: "doctor"
        },
        {
          id: "act_2",
          task: "Schedule an HbA1c retest in 3 months with formal pre-diabetes assessment",
          explanation: "Your average blood sugar over the last months is borderline. Tight monitoring is critical.",
          priority: "high",
          completed: false,
          type: "test"
        },
        {
          id: "act_3",
          task: "Establish an annual Kidney Monitoring and eGFR protection plan",
          explanation: "Declining eGFR needs early stage tracking. Restricting saturated fat and excessive sodium is non-negotiable.",
          priority: "high",
          completed: false,
          type: "test"
        },
        {
          id: "act_4",
          task: "Test Vitamin D levels with your physician",
          explanation: "East Asians are commonly deficient, which impacts metabolic health, blood pressure, and cardiovascular outcomes.",
          priority: "medium",
          completed: false,
          type: "test"
        },
        {
          id: "act_5",
          task: "Substitute butter, coconut oil, and ghee with extra virgin olive oil",
          explanation: "Reducing saturated fat to strictly under 15g a day is essential to restore proper LDL values.",
          priority: "high",
          completed: false,
          type: "lifestyle"
        }
      ],
      dailyBenefits: [
        { id: "ben_1", activity: "Accumulate 30 minutes of brisk walking or light cardio", target: "150 mins per week", completed: false },
        { id: "ben_2", activity: "Add 1 tablespoon of ground flaxseed to your meals", target: "Daily", completed: false },
        { id: "ben_3", activity: "Restrict Saturated Fat intake strictly under 15g", target: "Daily", completed: false },
        { id: "ben_4", activity: "Incorporate high soluble fibre (e.g. Oats, Psyllium husk)", target: "10-15g soluble", completed: false }
      ],
      latestInsights: [
        {
          title: "Cardiovascular Risk Reduction in East Asian Cohorts",
          summary: "Recent studies demonstrate that East Asian men exhibit heightened sensitivity to low-dose statin therapy, with rosuvastatin 5mg yielding similar LDL reduction as 10mg in western populations while minimizing hepatic and muscular side effects.",
          link: "https://pubmed.ncbi.nlm.nih.gov/32041285/"
        },
        {
          title: "Soluble Fibre and Bile Acid Sequestration Mechanics",
          summary: "Clinical trials confirm that consuming 10g of soluble fibre daily (via oats, barley, or psyllium husk) triggers hepatic bile synthesis from existing LDL, lowering circulating bad cholesterol particles by 5% to 10% within 8 weeks.",
          link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4832151/"
        }
      ],
      healthRiskForecast: {
        year5: "Mildly progressive atherosclerosis, risk of transitioning from borderline pre-diabetes to active Type 2 Diabetes, and decline in renal filtration capacity to Stage 3 CKD.",
        year10: "Significant vascular plaque buildup. Kidney function might drop to GFR < 60, triggering high blood pressure. Elevated Risk of cardiovascular events.",
        year20: "40% probability of a coronary event. Accelerated kidney wear requiring complex nephrological intervention.",
        optimized5: "Restored LDL < 100 mg/dL, stabilized blood sugar in normal ranges, and kidney filtration preserved at healthy levels.",
        optimized10: "Plaque progression halted. Fully functional cardiovascular system and kidney values stabilized in the safe green zone.",
        optimized20: "Optimal cardiovascular performance. Healthy aging index score 95th percentile, active longevity with zero diabetic or renal complications."
      }
    };
  }

  // Standard generic profile-based fallback
  return {
    timestamp: new Date().toISOString(),
    dailyNutrientTargets: {
      calories: "1,500–1,600 kcal",
      protein: "80–90 g",
      totalFat: "50–60 g",
      saturatedFat: "under 12 g",
      unsaturatedFat: "30–40 g",
      omega3: "2.0–2.5 g",
      carbohydrates: "150–170 g",
      addedSugar: "under 15 g",
      totalFibre: "30–35 g",
      solubleFibre: "8–12 g",
      sodium: "under 1,500 mg",
      potassium: "3,500 mg",
      magnesium: "400 mg",
      calcium: "1,000 mg",
      iron: "8 mg",
      zinc: "11 mg",
      selenium: "55 mcg",
      iodine: "150 mcg",
      phosphorus: "700 mg",
      vitaminD: "2,000 IU",
      vitaminB12: "2.4 mcg",
      folate: "400 mcg",
      vitaminC: "90 mg",
      vitaminE: "15 mg",
      vitaminK: "120 mcg",
      vitaminA: "900 mcg",
      vitaminB6: "1.7 mg",
      thiamine: "1.2 mg",
      riboflavin: "1.3 mg",
      niacin: "16 mg"
    },
    mostImportantNextStep: "Reduce saturated fat strictly to under 12g per day and complete a clinical blood re-test in 3 months to monitor cholesterol and glucose trends.",
    actions: [
      {
        id: "act_1",
        task: "Consult your primary care physician for a comprehensive health screening",
        explanation: "Based on your age and profile, regular annual biometric reviews are highly recommended.",
        priority: "high",
        completed: false,
        type: "doctor"
      },
      {
        id: "act_2",
        task: "Check your HbA1c and lipid panel every 6 months",
        explanation: "Routine blood metrics tracking will help confirm your lifestyle changes are successfully restoring biomarkers.",
        priority: "high",
        completed: false,
        type: "test"
      }
    ],
    dailyBenefits: [
      { id: "ben_1", activity: "Walk briskly for 30 minutes daily to boost metabolic health", target: "Daily", completed: false },
      { id: "ben_2", activity: "Substitute saturated fats with cold-pressed olive oil", target: "Daily", completed: false }
    ],
    latestInsights: [
      {
        title: "Dietary Fibers and Metabolic Longevity Indices",
        summary: "A high-fiber nutritional plan is linked to enhanced short-chain fatty acid gut synthesis, which improves overall insulin response and naturally reduces vascular inflammation markers.",
        link: "https://pubmed.ncbi.nlm.nih.gov/30612722/"
      }
    ],
    healthRiskForecast: {
      year5: "Slight vascular stiffness and mild risk of elevated glucose tolerance if sedentary habits persist.",
      year10: "Increasing risk of metabolic decline and minor cardiovascular strain.",
      year20: "Elevated probability of cardiovascular plaques and reduced active energy index.",
      optimized5: "Pristine blood pressure levels, balanced lipid particles, and metabolic health completely optimized.",
      optimized10: "Robust vascular health, optimized glycemic control, and ideal weight targets maintained.",
      optimized20: "Healthy aging with minimal chronic disease probability and vibrant metabolic index."
    }
  };
}
