// Skin sheets as the game reads them, after skinview-utils (bs-community/skinview-utils, src/process.ts):
// 64×32 skins from before 1.8 get their left limbs mirrored from the right ones, and a skin painted on an
// opaque background has its second layer cleared, or the hat and jacket would be solid boxes.

type Rect = [x: number, y: number, w: number, h: number];

/** Pre-1.8 left limbs: [source x, y, w, h, target x, y], each copied flipped. */
const LEGACY_COPIES: [number, number, number, number, number, number][] = [
  [4, 16, 4, 4, 20, 48], [8, 16, 4, 4, 24, 48], [0, 20, 4, 12, 24, 52], [4, 20, 4, 12, 20, 52], [8, 20, 4, 12, 16, 52], [12, 20, 4, 12, 28, 52],
  [44, 16, 4, 4, 36, 48], [48, 16, 4, 4, 40, 48], [40, 20, 4, 12, 40, 52], [44, 20, 4, 12, 36, 52], [48, 20, 4, 12, 32, 52], [52, 20, 4, 12, 44, 52],
];

/** The second layer: hat first, then (1.8 sheets only) legs, jacket and sleeves. */
const HAT: Rect[] = [[40, 0, 8, 8], [48, 0, 8, 8], [32, 8, 8, 8], [40, 8, 8, 8], [48, 8, 8, 8], [56, 8, 8, 8]];
const OUTER: Rect[] = [
  [4, 32, 4, 4], [8, 32, 4, 4], [0, 36, 4, 12], [4, 36, 4, 12], [8, 36, 4, 12], [12, 36, 4, 12],
  [20, 32, 8, 4], [28, 32, 8, 4], [16, 36, 4, 12], [20, 36, 8, 12], [28, 36, 4, 12], [32, 36, 8, 12],
  [44, 32, 4, 4], [48, 32, 4, 4], [40, 36, 4, 12], [44, 36, 4, 12], [48, 36, 4, 12], [52, 36, 12, 12],
  [4, 48, 4, 4], [8, 48, 4, 4], [0, 52, 4, 12], [4, 52, 4, 12], [8, 52, 4, 12], [12, 52, 4, 12],
  [52, 48, 4, 4], [56, 48, 4, 4], [48, 52, 4, 12], [52, 52, 4, 12], [56, 52, 4, 12], [60, 52, 4, 12],
];

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Skin image did not load"));
    img.src = src;
  });
}

/** A square 1.8 sheet (any multiple of 64) as an object URL; null when the image is not a skin. */
async function normalize(src: string): Promise<string | null> {
  const img = await load(src);
  const w = img.naturalWidth;
  const legacy = img.naturalHeight * 2 === w;
  if ((!legacy && img.naturalHeight !== w) || w % 64 || w > 1024) return null;
  const k = w / 64;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = w;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  if (legacy) {
    ctx.save();
    ctx.scale(-1, 1);
    for (const [sx, sy, cw, ch, dx, dy] of LEGACY_COPIES) ctx.drawImage(canvas, sx * k, sy * k, cw * k, ch * k, -dx * k, dy * k, -cw * k, ch * k);
    ctx.restore();
  }

  // Opaque everywhere = painted on a background: the second layer is that background, not clothing.
  const painted = legacy ? [0, 0, w, w / 2] : [0, 0, w, w];
  const alpha = ctx.getImageData(painted[0], painted[1], painted[2], painted[3]).data;
  let opaque = true;
  for (let i = 3; i < alpha.length; i += 4) if (alpha[i] !== 255) { opaque = false; break; }
  if (opaque) for (const [x, y, rw, rh] of legacy ? HAT : [...HAT, ...OUTER]) ctx.clearRect(x * k, y * k, rw * k, rh * k);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob && URL.createObjectURL(blob);
}

// ponytail: object URLs live for the session, one per skin seen; revoke on eviction if this ever holds hundreds.
const sheets = new Map<string, Promise<string | null>>();
/** Sheets already processed, so a remount paints the skin on its first frame. */
export const readySheets = new Map<string, string | null>();

/** Shared by every head and model showing the same skin, so each sheet is processed once. */
export function skinSheet(src: string): Promise<string | null> {
  let sheet = sheets.get(src);
  if (!sheet) {
    sheet = normalize(src)
      .catch(() => null)
      .then((url) => (readySheets.set(src, url), url));
    sheets.set(src, sheet);
  }
  return sheet;
}
