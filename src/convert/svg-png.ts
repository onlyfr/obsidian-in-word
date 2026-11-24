import {RasterError, type RasterResult} from "./mathimg";
const SCALE = 3;
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new RasterError("error", "the picture could not be loaded"));
    img.src = url;
  });
}

export async function svgPng(xml:string,w:number,h:number,baseline:number):Promise<RasterResult> {
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml));

  // 3. canvas -> PNG (SCALE x the CSS px size)
  const canvas = document.createElement("canvas");
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  const g = canvas.getContext("2d");
  if (!g) throw new RasterError("error", "no canvas");
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  let url: string;
  try {
    const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = false;
    for (let i = 3; i < px.length && !ink; i += 4) ink = px[i] > 32;
    if (!ink) throw new RasterError("blank", "nothing was drawn");
    url = canvas.toDataURL("image/png");
  } catch (e) {
    if (e instanceof RasterError) throw e;
    throw new RasterError("tainted", (e as Error)?.message);
  }
  const prefix = "data:image/png;base64,";
  if (!url.startsWith(prefix) || url.length === prefix.length) throw new RasterError("error", "PNG encoding failed");
  return { png: url.slice(prefix.length), w, h, baseline, scale: SCALE };
}
