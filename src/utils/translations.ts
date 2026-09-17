// Auto-generated durable i18n translations pack (thin aggregator).
// Source of truth: English (en). Indonesian (id) maintains key parity.
//
// Q-11.8 (milestone 8 of Q-11): the dictionaries themselves now live in
// `src/utils/translations/<lang>.ts` so no single file has to be transferred
// whole to edit one string. Keys and values are unchanged — this module is the
// stable import surface, so no call site had to move.
import { en } from './translations/en';
import { id } from './translations/id';
import { fr } from './translations/fr';
import { zh } from './translations/zh';

export const localePacks = {
  en,
  id,
  fr,
  zh,
};

export type TranslationKey = keyof typeof localePacks.en | string;

export const translations: Record<string, Record<string, string>> = {
  en: localePacks.en as unknown as Record<string, string>,
  id: localePacks.id as unknown as Record<string, string>,
  fr: new Proxy(localePacks.fr as any, {
    get: (target, prop: string) => target[prop] || (localePacks.en as any)[prop] || prop,
  }),
  zh: new Proxy(localePacks.zh as any, {
    get: (target, prop: string) => target[prop] || (localePacks.en as any)[prop] || prop,
  }),
};
