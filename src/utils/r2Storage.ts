/**
 * R2 Storage utility for uploading and deleting assets/payloads via API endpoints.
 */

/**
 * Resolve an API path against the current origin.
 *
 * In the browser relative URLs are correct. On the server (Node) `fetch`
 * rejects them outright — the job pipeline runs inside the same process as
 * Express, and a bare fetch('/api/r2/upload-job-result') threw "Failed to
 * parse URL" behind every successful meal, so the full result never reached
 * R2. INTERNAL_BASE_URL points the process at its own listener.
 */
export function resolveApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') return p;
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined;
  const base = (env && (env.INTERNAL_BASE_URL || env.API_BASE_URL)) || 'http://127.0.0.1:3000';
  return `${String(base).replace(/\/+$/, '')}${p}`;
}

export async function uploadPhotoToR2(
  photoDataOrId: string | Blob,
  optionsOrData?: { prefix?: string; filename?: string } | string,
  index?: number
): Promise<string> {
  try {
    if (typeof photoDataOrId === 'string' && typeof optionsOrData === 'string') {
      const id = photoDataOrId;
      const base64 = optionsOrData;
      const filename = `${id}${typeof index === 'number' && index > 0 ? `_${index}` : ''}.jpg`;
      const res = await fetch(resolveApiUrl('/api/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: base64,
          prefix: 'photos',
          filename
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.url || data.key || '';
      }
      return base64;
    }

    const photoData = photoDataOrId;
    const options = optionsOrData as { prefix?: string; filename?: string } | undefined;
    const res = await fetch(resolveApiUrl('/api/upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: typeof photoData === 'string' ? photoData : await blobToBase64(photoData),
        prefix: options?.prefix || 'photos',
        filename: options?.filename
      })
    });
    if (res.ok) {
      const data = await res.json();
      return data.url || data.key || '';
    }
  } catch (err) {
    console.warn('[r2Storage] Photo upload failed, falling back to local data URI:', err);
  }
  return typeof photoDataOrId === 'string' ? photoDataOrId : (typeof optionsOrData === 'string' ? optionsOrData : URL.createObjectURL(photoDataOrId));
}

export async function uploadPhotosToR2(
  photosOrJobId: (string | Blob)[] | string,
  optionsOrPhotos?: { prefix?: string } | (string | Blob)[]
): Promise<string[]> {
  if (typeof photosOrJobId === 'string' && Array.isArray(optionsOrPhotos)) {
    const jobId = photosOrJobId;
    const photos = optionsOrPhotos;
    return Promise.all(photos.map((p, idx) => uploadPhotoToR2(jobId, typeof p === 'string' ? p : '', idx)));
  }
  const photos = Array.isArray(photosOrJobId) ? photosOrJobId : [];
  const options = optionsOrPhotos as { prefix?: string } | undefined;
  return Promise.all(photos.map(p => uploadPhotoToR2(p, options)));
}

export async function uploadDebugPayloadToR2(jobId: string, payload: any): Promise<string> {
  try {
    const res = await fetch(resolveApiUrl('/api/debug/upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload })
    });
    if (res.ok) {
      const data = await res.json();
      return data.debugUrl || data.url || '';
    }
  } catch (err) {
    console.warn('[r2Storage] uploadDebugPayloadToR2 failed:', err);
  }
  return '';
}

export async function deleteDebugPayloadFromR2(jobIdOrUrl: string, userId?: string): Promise<boolean> {
  if (!jobIdOrUrl) return false;
  try {
    const res = await fetch(resolveApiUrl('/api/debug/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: jobIdOrUrl, userId })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] deleteDebugPayloadFromR2 error:', err);
    return false;
  }
}

export async function uploadLogsToR2(key: string, data: any): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl('/api/r2/upload-logs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] uploadLogsToR2 error:', err);
    return false;
  }
}

export async function fetchLogsFromR2(key: string): Promise<any> {
  try {
    const res = await fetch(resolveApiUrl(`/api/r2/logs?key=${encodeURIComponent(key)}`));
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchLogsFromR2 error:', err);
  }
  return null;
}

export async function fetchDebugPayloadFromR2(jobIdOrUrl: string): Promise<any> {
  try {
    const res = await fetch(resolveApiUrl(`/api/debug/load?jobId=${encodeURIComponent(jobIdOrUrl)}`));
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchDebugPayloadFromR2 error:', err);
  }
  return null;
}

/**
 * Persist a finished job result to R2 and return its public URL, or '' when
 * the upload fails. serverJobs persists this URL as the `r2_url` of the D1
 * pointer, so the return value is part of the contract (it used to return a
 * bare boolean, which left `r2_url: true` unreachable).
 *
 * The route reads `payload`; `result` is also sent so an older route build
 * that still reads `result` keeps working during a rolling deploy.
 */
export async function uploadJobResultToR2(jobId: string, result: any): Promise<string> {
  try {
    const res = await fetch(resolveApiUrl('/api/r2/upload-job-result'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, payload: result, result })
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return data.url || data.r2_url || '';
  } catch (err) {
    console.warn('[r2Storage] uploadJobResultToR2 error:', err);
    return '';
  }
}

export async function fetchJobResultFromR2(jobId: string): Promise<any> {
  try {
    const res = await fetch(resolveApiUrl(`/api/r2/job-result?jobId=${encodeURIComponent(jobId)}`));
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('[r2Storage] fetchJobResultFromR2 error:', err);
  }
  return null;
}

export async function deleteR2ObjectByKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl('/api/r2/delete-object'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    return res.ok;
  } catch (err) {
    console.warn('[r2Storage] deleteR2ObjectByKey error:', err);
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
