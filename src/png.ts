/**
 * SVG → PNG, locally (no chart service sees the data). resvg ships a prebuilt
 * native binary per platform, so the 1 GB server needs no image toolchain.
 * Telegram's sendPhoto does not accept SVG, hence this step. Heebo (OFL, in
 * assets/fonts) is bundled so Hebrew renders identically on laptop and server;
 * system fonts stay loaded for the weekly chart's DejaVu.
 */
import { Resvg } from "@resvg/resvg-js";

const FONTS = `${import.meta.dir}/../assets/fonts`;
const FONT_FILES = ["Regular", "Bold", "Black"].map((w) => `${FONTS}/Heebo-${w}.ttf`);

export function svgToPng(svg: string): Uint8Array {
  const r = new Resvg(svg, {
    background: "#ffffff",
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: "Heebo" },
  });
  return r.render().asPng();
}
