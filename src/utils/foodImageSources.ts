/** Tokens that must never be treated as displayable meal photos */
export const UNUSABLE_IMAGE_TOKENS = new Set([
  '[image_removed_for_snapshot]',
  'Image reference preserved',
  'loading',
  'Image reference preserved.',
]);

/** B11d — prefer app proxy so private R2 buckets still load on other devices. */
export const PHOTO_PROXY_PREFIX = '/photos/';
export const PHOTO_PROXY_API = '/api/r2/photos/';

export function isUsableImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || UNUSABLE_IMAGE_TOKENS.has(u)) return false;
  // Explicit token substrings (sometimes embedded in longer placeholder strings)
  if (u.includes('image_removed_for_snapshot')) return false;
  if (u.includes('Image reference preserved')) return false;
  if (u.startsWith('data:image/')) return u.length > 32;
  if (u.startsWith('blob:')) return true;
  // App proxies R2 public URLs as /photos/{key}
  if (u.startsWith('/photos/') && u.length > 9) return true;
  if (u.startsWith('/api/r2/photos/') && u.length > 16) return true;
  if (/^https?:\/\//i.test(u)) return u.length < 2000;
  return false;
}

/**
 * Normalize meal photo URLs for display.
 * B11d: rewrite Cloudflare R2 public URLs → same-origin `/photos/{key}` proxy
 * so multi-device works even when the bucket is private (401 on r2.dev).
 */
export function normalizeMealImageUrl(url: unknown): string | undefined {
  if (!isUsableImageUrl(url)) return undefined;
  let u = url.trim();

  // Strip query/hash for key extraction; keep signed query if already our API
  if (u.startsWith('/api/r2/photos/')) return u;
  if (u.startsWith('/photos/')) {
    // ensure .jpg key form is usable
    return u;
  }

  // https://pub-….r2.dev/photos/jobId.jpg → /photos/jobId.jpg
  const r2Photos = u.match(/\.r2\.dev\/photos\/([^?#]+)/i);
  if (r2Photos?.[1]) {
    return `${PHOTO_PROXY_PREFIX}${r2Photos[1].replace(/^\/+/, '')}`;
  }

  // https://…/photos/jobId.jpg (any host)
  const anyPhotos = u.match(/\/photos\/([^?#]+)/i);
  if (anyPhotos?.[1] && /^https?:\/\//i.test(u)) {
    return `${PHOTO_PROXY_PREFIX}${anyPhotos[1].replace(/^\/+/, '')}`;
  }

  return u;
}

/** Extract R2 object key from a meal photo URL (for signed GET). */
export function photoKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  const m =
    u.match(/\/(?:api\/r2\/)?photos\/([^?#]+)/i) ||
    u.match(/\.r2\.dev\/photos\/([^?#]+)/i);
  if (!m?.[1]) return null;
  let key = m[1].replace(/^\/+/, '');
  if (!key.includes('.')) key = `${key}.jpg`;
  return key.slice(0, 200);
}

/**
 * B11d — if primary URL fails (private R2), try proxy then signed API.
 * Returns next URL to try, or null if exhausted.
 */
export function nextPhotoFallbackUrl(failedUrl: string, tried: Set<string>): string | null {
  const candidates: string[] = [];
  const key = photoKeyFromUrl(failedUrl);
  if (key) {
    candidates.push(`${PHOTO_PROXY_PREFIX}${key}`);
    candidates.push(`${PHOTO_PROXY_API}${key}`);
    candidates.push(`/api/r2/photo-url?key=${encodeURIComponent(key)}`);
  }
  const norm = normalizeMealImageUrl(failedUrl);
  if (norm) candidates.push(norm);

  for (const c of candidates) {
    if (c && !tried.has(c) && c !== failedUrl) return c;
  }
  return null;
}

/**
 * B11d — given a failed image src, resolve the next URL to try (awaiting the
 * signed-URL API when that's the candidate), or null if every fallback in
 * nextPhotoFallbackUrl() has already been tried. Shared by any component that
 * displays a food/meal photo and wants to self-heal from an expired/private
 * R2 URL rather than showing a permanently broken image.
 */
export async function resolveNextPhotoUrl(
  original: string,
  current: string,
  tried: Set<string>
): Promise<string | null> {
  let next = nextPhotoFallbackUrl(current, tried);
  if (next?.includes('/api/r2/photo-url')) {
    try {
      const key = photoKeyFromUrl(current) || photoKeyFromUrl(original);
      const res = await fetch(`/api/r2/photo-url?key=${encodeURIComponent(key || '')}`);
      if (res.ok) {
        const json = await res.json();
        next = json.proxyUrl || json.url || next;
      }
    } catch {
      /* keep next */
    }
  }
  if (next && !tried.has(next)) return next;
  return null;
}
/**
 * Ordered candidates for a meal/job (first usable wins for primary display).
 * Does NOT invent stock/catalog images.
 */
export function resolveMealImageCandidates(input: {
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  photoUrl?: string | null;
  messageImageUrl?: string | null;
  messageImageUrls?: string[] | null;
}): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const norm = normalizeMealImageUrl(v);
    if (norm && !out.includes(norm)) out.push(norm);
  };
  push(input.photoUrl);
  push(input.imageUrl);
  push(input.messageImageUrl);
  if (Array.isArray(input.imageUrls)) input.imageUrls.forEach(push);
  if (Array.isArray(input.messageImageUrls)) input.messageImageUrls.forEach(push);
  return uniqueMealImageUrls(out);
}

/**
 * Collapse the same photo under different hosts (r2.dev vs /photos/ vs signed API).
 * Force Pull used exact-string Set and showed one meal twice.
 */
export function uniqueMealImageUrls(urls: Array<string | null | undefined>): string[] {
  const durable: string[] = [];
  const ephemeral: string[] = [];
  const seenDurable = new Set<string>();
  const seenEph = new Set<string>();
  for (const u of urls) {
    const norm = normalizeMealImageUrl(u);
    if (!norm) continue;
    const isEph = norm.startsWith('data:') || norm.startsWith('blob:');
    if (isEph) {
      if (seenEph.has(norm)) continue;
      seenEph.add(norm);
      ephemeral.push(norm);
      continue;
    }
    const key = photoKeyFromUrl(norm) || photoKeyFromUrl(u) || norm.split('?')[0];
    if (seenDurable.has(key)) continue;
    seenDurable.add(key);
    durable.push(norm);
  }
  // After log/upload the same capture exists as data: AND /photos/key — keep durable only.
  if (durable.length > 0) return durable;
  return ephemeral;
}

/**
 * Photos to show when reusing a saved / previous meal. Walks the tag, original
 * log, in-memory foodLogs, then the R2 key convention photos/{id}.jpg.
 */
export function collectSavedMealImageUrls(
  source: {
    imageUrl?: string;
    imageUrls?: string[] | string;
    photoUrl?: string;
    image_url?: string;
    image_urls?: string[] | string;
    originalLog?: any;
    item?: any;
    dbId?: string;
    id?: string;
    food_id?: string;
  } | null | undefined,
  foodLogs?: Array<{ id?: string; imageUrl?: string; imageUrls?: string[] }> | null,
  opts?: { allowSynthesized?: boolean },
): string[] {
  if (!source) return [];
  const allowSynthesized = opts?.allowSynthesized !== false;
  const raw: unknown[] = [];
  const pushFrom = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    raw.push(obj.imageUrl, obj.photoUrl, obj.image_url);
    const arr = obj.imageUrls ?? obj.image_urls;
    if (Array.isArray(arr)) raw.push(...arr);
    else if (typeof arr === 'string' && arr) raw.push(arr);
    if (Array.isArray(obj.itemsBreakdown)) {
      for (const it of obj.itemsBreakdown) {
        if (!it) continue;
        raw.push(it.imageUrl, Array.isArray(it.imageUrls) ? it.imageUrls[0] : undefined);
      }
    }
  };
  pushFrom(source);
  pushFrom(source.originalLog);
  pushFrom(source.item);
  let urls = uniqueMealImageUrls(raw as Array<string | null | undefined>);
  const id = String(source.dbId || source.id || source.food_id || source.originalLog?.id || '').trim();
  // Union donor images from in-memory logs (T-6): API search results often
  // carry only a single preview imageUrl while the full log holds the rest.
  // Donor urls append after source urls, so primary-image order is unchanged.
  if (foodLogs?.length && id) {
    const donor = foodLogs.find((f) => f && String(f.id) === id);
    if (donor) {
      const donorUrls = uniqueMealImageUrls([donor.imageUrl, ...(Array.isArray(donor.imageUrls) ? donor.imageUrls : [])]);
      for (const u of donorUrls) {
        if (u && !urls.includes(u)) urls.push(u);
      }
    }
  }
  if (urls.length === 0 && allowSynthesized && id && !id.startsWith('brand_')) {
    const safe = id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
    urls = uniqueMealImageUrls([`${PHOTO_PROXY_PREFIX}${safe}.jpg`]);
  }
  return urls;
}

/**
 * Convert a captured Blob/File into a durable base64 data URL instead of a
 * throwaway blob: object URL. blob: URLs only resolve in the browser tab/session
 * that created them, so they must never be persisted into any object that is
 * saved to a food log or pushed through sync — the server's push handler only
 * knows how to auto-upload data:image/ URLs to R2 (see server_routes_sync.ts).
 */
export function blobToDurableDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

export const IMAGE_PRESERVE_LOG = '[ImagePreserve]';
