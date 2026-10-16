/**
 * Image attachments.
 *
 * A pasted or picked image is decoded and, when it is larger than a provider
 * comfortably takes, scaled down and re-encoded. That takes time, so an
 * attachment carries a status: the composer draws it with a spinner while it is
 * `processing`, and holds the send back until none of them are.
 */

/** Longest side kept, in px; a larger image is scaled down before it is sent. */
const MAX_SIDE = 1600;
/** JPEG quality used for a rescaled image. */
const QUALITY = 0.85;

type AttachmentStatus = "processing" | "ready" | "error";

export interface Attachment {
  id: string;
  /** The file's own name, for the tile and its ways out. */
  name: string;
  /** Object URL of the file as it arrived, drawn at once. */
  preview: string;
  /** The data URL to send; empty until the image is ready. */
  url: string;
  status: AttachmentStatus;
}

/** A new attachment for `file`, drawn from its object URL and still processing. */
export function newAttachment(file: File): Attachment {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    preview: URL.createObjectURL(file),
    url: "",
    status: "processing",
  };
}

function readAsDataUrl(file: Blob): Promise<string> {
  const reader = new FileReader();
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error("could not read the image"));
  reader.readAsDataURL(file);
  return promise;
}

/**
 * The data URL an image is sent as. One within `MAX_SIDE` is sent as it came —
 * which keeps a PNG's transparency and a screenshot's exact pixels — and only a
 * larger one is scaled down and re-encoded, on a white ground so whatever
 * transparency it had does not come out black.
 */
export async function processImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) {
    bitmap.close();
    return readAsDataUrl(file);
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("the image could not be drawn");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}
