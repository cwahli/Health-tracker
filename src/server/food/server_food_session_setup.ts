import {
  detectWeightRefineIntent,
  shouldSkipScoutForWeightRefine,
} from '../../../server_refine_scale.js';

/**
 * F-8.10 shard 13 — request/session setup, extracted verbatim from
 * runFoodAnalyze. Image payload collection and the weight-refine triad.
 * Streaming/session plumbing stays in the pipeline.
 */

/** Collects and dedupes image payloads from the request body. */
export function collectImagePayloads(image: any, images: any): any[] {
  const imagePayloads: any[] = [];
  if (image) {
    imagePayloads.push(image);
  }
  if (Array.isArray(images)) {
    images.forEach((img: any) => {
      if (img && !imagePayloads.includes(img)) {
        imagePayloads.push(img);
      }
    });
  }
  return imagePayloads;
}

export interface WeightRefineArgs {
  body: any;
  message?: string;
  imagePayloads: any;
  activeMeal: any;
}

/**
 * B5 weight/portion refine triad: prior scout, skip decision, intent, and
 * the pure-weight-modification flag. Path A: text-only refine. Path B:
 * images still attached but printed label locks exist.
 */
export function decideWeightRefine(args: WeightRefineArgs): {
  priorScoutForRefine: any[];
  refineDecision: any;
  weightRefineIntent: any;
  isPureWeightModification: boolean;
} {
  const { body, message, imagePayloads, activeMeal } = args;
  const priorScoutForRefine = Array.isArray(body.activeScoutItems) ? body.activeScoutItems : [];
  const refineDecision = shouldSkipScoutForWeightRefine({
    message,
    imageCount: imagePayloads?.length || 0,
    activeScoutItems: priorScoutForRefine,
    activeMeal,
    explicitSkipScout: body.skipScout === true,
  });
  const weightRefineIntent = refineDecision.intent.isRefine
    ? refineDecision.intent
    : detectWeightRefineIntent(message);
  // Pure weight modification: only true if there is an explicit numerical gram weight for the whole meal
  const isPureWeightModification = !!(
    (refineDecision.skip && weightRefineIntent.isRefine && weightRefineIntent.kind === 'absolute_grams' && typeof weightRefineIntent.weightGrams === 'number' && weightRefineIntent.weightGrams > 0 && !weightRefineIntent.targetHint) ||
    (
      activeMeal &&
      (!imagePayloads || imagePayloads.length === 0) &&
      message &&
      weightRefineIntent.isRefine &&
      weightRefineIntent.kind === 'absolute_grams' &&
      typeof weightRefineIntent.weightGrams === 'number' &&
      weightRefineIntent.weightGrams > 0 &&
      !weightRefineIntent.targetHint &&
      !/\b(only|remove|delete|without|except|no|instead|replace|add|plus|with|not|didn't|did\s+not)\b/i.test(message)
    )
  );
  return { priorScoutForRefine, refineDecision, weightRefineIntent, isPureWeightModification };
}
