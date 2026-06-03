// Image export: snapshot the NGL viewport and save it to the host as PNG, JPEG,
// TIFF or SVG. In Electron we use a native "Save as…" dialog; in a plain browser
// we fall back to a normal download.

import { Viewer } from "./ngl-viewer";

export type ExportFormat = "png" | "jpeg" | "tiff" | "svg";

const VIEWPORT_BG = "#13161b"; // matches the NGL stage background

const EXT: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", tiff: "tiff", svg: "svg" };
const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  png: { name: "PNG image", extensions: ["png"] },
  jpeg: { name: "JPEG image", extensions: ["jpg", "jpeg"] },
  tiff: { name: "TIFF image", extensions: ["tiff", "tif"] },
  svg: { name: "SVG (scalable)", extensions: ["svg"] },
};

export async function exportView(
  viewer: Viewer,
  format: ExportFormat,
  scale = 2,
  baseName = "meon-spring-view"
): Promise<{ saved: boolean; path?: string }> {
  // Render the scene to an opaque canvas (alpha composited over the bg).
  const png = await viewer.snapshot(scale);
  const bmp = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = VIEWPORT_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);

  let bytes: Uint8Array;
  if (format === "png") {
    bytes = await canvasBytes(canvas, "image/png");
  } else if (format === "jpeg") {
    bytes = await canvasBytes(canvas, "image/jpeg", 0.92);
  } else if (format === "tiff") {
    bytes = encodeTiffRGB(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } else {
    bytes = svgWrap(canvas.toDataURL("image/png"), canvas.width, canvas.height);
  }

  return saveBytes(`${baseName}.${EXT[format]}`, bytes, FILTERS[format]);
}

async function canvasBytes(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// A scalable SVG that embeds the high-resolution raster. (True vectorisation of a
// 3D WebGL scene isn't feasible; this gives a resolution-independent container
// that opens in Illustrator/Inkscape and prints crisply.)
function svgWrap(dataUrl: string, w: number, h: number): Uint8Array {
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `  <image width="${w}" height="${h}" xlink:href="${dataUrl}"/>\n` +
    `</svg>\n`;
  return new TextEncoder().encode(svg);
}

// Minimal baseline, uncompressed RGB TIFF encoder (little-endian).
function encodeTiffRGB(img: ImageData): Uint8Array {
  const { width: w, height: h, data } = img;
  const nEntries = 10;
  const ifdOffset = 8;
  const ifdSize = 2 + nEntries * 12 + 4;
  const bpsOffset = ifdOffset + ifdSize; // [8,8,8] shorts
  const dataOffset = bpsOffset + 6;
  const pixelBytes = w * h * 3;
  const dv = new DataView(new ArrayBuffer(dataOffset + pixelBytes));

  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); // "II" little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);

  let o = ifdOffset;
  dv.setUint16(o, nEntries, true); o += 2;
  const entry = (tag: number, type: number, count: number, value: number) => {
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, count, true); dv.setUint32(o + 8, value, true); o += 12;
  };
  // tags MUST be in ascending order (TIFF baseline); types: 3=SHORT, 4=LONG
  entry(256, 4, 1, w);            // ImageWidth
  entry(257, 4, 1, h);            // ImageLength
  entry(258, 3, 3, bpsOffset);    // BitsPerSample -> [8,8,8]
  entry(259, 3, 1, 1);            // Compression: none
  entry(262, 3, 1, 2);            // PhotometricInterpretation: RGB
  entry(273, 4, 1, dataOffset);   // StripOffsets
  entry(277, 3, 1, 3);            // SamplesPerPixel
  entry(278, 4, 1, h);            // RowsPerStrip (single strip)
  entry(279, 4, 1, pixelBytes);   // StripByteCounts
  entry(284, 3, 1, 1);            // PlanarConfiguration: chunky
  dv.setUint32(o, 0, true);       // next IFD = none

  dv.setUint16(bpsOffset, 8, true);
  dv.setUint16(bpsOffset + 2, 8, true);
  dv.setUint16(bpsOffset + 4, 8, true);

  let q = dataOffset;
  for (let i = 0; i < w * h; i++) {
    const s = i * 4;
    dv.setUint8(q++, data[s]); dv.setUint8(q++, data[s + 1]); dv.setUint8(q++, data[s + 2]);
  }
  return new Uint8Array(dv.buffer);
}

async function saveBytes(
  name: string,
  bytes: Uint8Array,
  filter: { name: string; extensions: string[] }
): Promise<{ saved: boolean; path?: string }> {
  const pma = window.PMA as any;
  if (pma?.saveFile) {
    return pma.saveFile(name, bytes, [filter, { name: "All files", extensions: ["*"] }]);
  }
  // Browser fallback: trigger a download.
  const blob = new Blob([bytes as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true };
}
