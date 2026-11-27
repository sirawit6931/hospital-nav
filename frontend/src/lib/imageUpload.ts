import { api, type UploadResponse } from "./api";

const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_JPEG_QUALITY = 0.8;

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

/**
 * Compresses and downscales an image file on the client before upload
 * (max width/height 1280px, JPEG quality ~0.8) so multi-photo mobile uploads
 * stay fast and reliable even over Cloudflare Tunnel.
 */
export async function compressImageFile(
  file: File,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_JPEG_QUALITY
): Promise<File> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) {
    return file;
  }

  try {
    const img = await loadImageElement(file);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return file;

    const longestSide = Math.max(srcW, srcH);
    const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Fill white background before JPEG export in case source image has transparency
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return file;

    // Keep original if compressed result is unexpectedly larger and no resize occurred
    if (scale === 1 && blob.size >= file.size && file.type === "image/jpeg") {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "building-photo";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/**
 * Compresses each selected image file and uploads sequentially to POST /api/admin/upload.
 */
export async function uploadCompressedImages(
  files: FileList | File[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const fileArray = Array.from(files);
  const uploadedUrls: string[] = [];

  for (let i = 0; i < fileArray.length; i++) {
    const compressed = await compressImageFile(fileArray[i]);
    const formData = new FormData();
    formData.append("file", compressed);

    const res = await api.post<UploadResponse>("/api/admin/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    const url = (res.data.image_url || res.data.url || "").trim();
    if (url) {
      uploadedUrls.push(url);
    }
    onProgress?.(i + 1, fileArray.length);
  }

  return uploadedUrls;
}
