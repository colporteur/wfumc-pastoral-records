// Client-side image helpers — decode an arbitrary image file (JPEG,
// PNG, HEIC where the OS supports it) into a JPEG blob no larger than
// `maxDim` on the longer side. Mirrors the bulletin app's helper so
// behavior is consistent across the suite.

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> fallback */
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Browser couldn't decode "${file.type || 'unknown format'}".`
        )
      );
    };
    img.src = url;
  });
}

export async function prepareImageForUpload(
  file,
  maxDim = 1600,
  quality = 0.85
) {
  let source;
  try {
    source = await decodeImage(file);
  } catch (decodeErr) {
    throw new Error(
      `Couldn't read this image (${file.type || 'unknown format'}). ` +
        `Some phone photo formats (like HEIC) aren't supported on every ` +
        `browser. Save the picture as JPEG/PNG before uploading, or use ` +
        `the Camera button (which always saves as JPEG).`
    );
  }

  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  if (!w || !h) {
    throw new Error(
      'Decoded image has zero dimensions — the file may be corrupted.'
    );
  }

  let nw = w;
  let nh = h;
  const longer = Math.max(w, h);
  if (longer > maxDim) {
    const ratio = maxDim / longer;
    nw = Math.round(w * ratio);
    nh = Math.round(h * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, nw, nh);

  if (typeof source.close === 'function') {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('Canvas toBlob returned null — out of memory?')),
      'image/jpeg',
      quality
    );
  });

  return { blob, mediaType: 'image/jpeg' };
}
