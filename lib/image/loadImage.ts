export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface LoadedImage {
  /** Original, untouched file. Detection reads pixels from this. */
  file: Blob;
  name: string;
  /** Object URL for display only. Revoke with URL.revokeObjectURL when replaced. */
  url: string;
  /** Size in source-image pixels. */
  width: number;
  height: number;
}

export function isAcceptedType(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** Reads the image size without resizing or smoothing anything. */
export async function loadImage(file: Blob, name = 'pasted-image'): Promise<LoadedImage> {
  if (!isAcceptedType(file.type)) {
    throw new Error('Unsupported file. Use a PNG, JPG or WEBP image.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read this image. The file may be damaged.');
  }
  const { width, height } = bitmap;
  bitmap.close();
  return { file, name, url: URL.createObjectURL(file), width, height };
}
