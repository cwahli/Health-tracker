/**
 * Utilities for extracting snapshot fixture data and picking active snapshot jobs.
 */
import { get as getFromIdb } from 'idb-keyval';

export interface OriginalFixture {
  photos: string[];
  text: string;
  jobId: string;
}

export function pickSnapshotJob(jobs: any[], preferredJobId?: string | null): any {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;

  const validJobs = jobs.filter((j) => j && typeof j === 'object');
  if (validJobs.length === 0) return null;

  if (preferredJobId) {
    const found = validJobs.find((j) => String(j.id) === String(preferredJobId));
    if (found) return found;
  }

  return validJobs.slice().sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.finishedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.finishedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  })[0] || null;
}

export async function collectOriginalFixture(job: any): Promise<OriginalFixture> {
  const photos: string[] = [];
  const text = job?.inputSnapshot?.text || job?.raw_text || job?.text || '';
  const jobId = job?.id || '';

  const addPhoto = (p?: string | null) => {
    if (typeof p === 'string' && p.trim() && !photos.includes(p.trim())) {
      photos.push(p.trim());
    }
  };

  // Direct photo URLs
  addPhoto(job?.photoUrl);
  addPhoto(job?.photo_url);
  addPhoto(job?.photo_url_full);
  addPhoto(job?.result?.photoUrl);
  addPhoto(job?.result?.photo_url);
  addPhoto(job?.result?.pendingFoodLog?.imageUrl);
  addPhoto(job?.result?.data?.pendingFoodLog?.imageUrl);

  // Array of images
  if (Array.isArray(job?.photos)) {
    for (const p of job.photos) addPhoto(p);
  }
  if (Array.isArray(job?.inputSnapshot?.imageRefs)) {
    for (const ref of job.inputSnapshot.imageRefs) {
      if (typeof ref === 'string') {
        try {
          const blob = await getFromIdb<string | Blob>(ref);
          if (blob instanceof Blob) {
            addPhoto(URL.createObjectURL(blob));
          } else if (typeof blob === 'string') {
            addPhoto(blob);
          } else {
            addPhoto(ref);
          }
        } catch {
          addPhoto(ref);
        }
      }
    }
  }
  if (Array.isArray(job?.inputSnapshot?.images)) {
    for (const img of job.inputSnapshot.images) addPhoto(img);
  }

  return {
    photos,
    text,
    jobId,
  };
}
