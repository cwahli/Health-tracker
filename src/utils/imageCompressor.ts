/**
 * Utility to compress images on the client side using HTML5 Canvas
 * to prevent exceeding Firestore 1MB document limit.
 */

export interface CompressionProgress {
  currentIndex: number;
  totalCount: number;
  percentage: number;
  stage: 'loading' | 'compressing' | 'done';
}

export function compressImage(
  base64OrFile: string | File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (base64OrFile instanceof File) {
      let objectUrl: string;
      try {
        objectUrl = URL.createObjectURL(base64OrFile);
      } catch (err) {
        reject(err);
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          // Calculate aspect ratio resizing
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not get 2D context from canvas'));
            return;
          }

          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(objectUrl);
          resolve(compressedBase64);
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image via ObjectURL: ' + (err instanceof Error ? err.message : 'Unknown error')));
      };

      img.src = objectUrl;
    } else {
      // It's a base64 string already
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          // Calculate aspect ratio resizing
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get 2D context from canvas'));
            return;
          }

          // Draw and compress
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = (err) => {
        reject(new Error('Failed to load base64 image: ' + (err instanceof Error ? err.message : 'Unknown error')));
      };

      img.src = base64OrFile;
    }
  });
}

/**
 * Compress multiple images sequentially with a progress callback
 */
export async function compressMultipleImages(
  files: any,
  onProgress?: (progress: CompressionProgress) => void,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85
): Promise<string[]> {
  const list = Array.from(files) as (File | string)[];
  const results: string[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    
    // Notify starting compression
    if (onProgress) {
      onProgress({
        currentIndex: i + 1,
        totalCount: list.length,
        percentage: Math.round((i / list.length) * 100),
        stage: 'compressing'
      });
    }

    try {
      const compressed = await compressImage(item, maxWidth, maxHeight, quality);
      results.push(compressed);
    } catch (err) {
      console.error(`Error compressing image at index ${i}:`, err);
      // Fallback: If it's a base64 string, keep it; if it's a file, read as raw base64 data URL
      if (typeof item === 'string') {
        results.push(item);
      } else if (item instanceof File) {
        try {
          const rawBase64 = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(item);
          });
          results.push(rawBase64);
        } catch (readErr) {
          console.error(`Error reading raw file fallback at index ${i}:`, readErr);
        }
      }
    }
  }

  if (onProgress) {
    onProgress({
      currentIndex: list.length,
      totalCount: list.length,
      percentage: 100,
      stage: 'done'
    });
  }

  return results;
}
