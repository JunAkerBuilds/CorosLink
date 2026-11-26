// The 12-hour clock's two pictures, AM and PM, each replaced on its own. CorosLink's AM/PM Pictures: a picture wins
// over lettering (the font picker brings lettering back), and Use the template's puts both back.
import { useRef, useState } from "react";
import type { CorosWatchfaceArtwork, CorosWatchfaceRasterFont } from "../../watchface/types";
import type { Design } from "../studioFace";
import { readArtwork } from "../studioEdits";
import { t } from "@/lib/i18n";
import { Icon } from "./StudioIcon";

type Edit = (fn: (d: Design) => Design) => void;
export type AmPm = "AM" | "PM";

/** Puts a picture in for AM or PM, kept as a PNG set on the indicator. */
export function setAmPmPicture(design: Design, which: AmPm, art: CorosWatchfaceArtwork): Design {
  const current = design.ampmIndicator;
  if (!current) return design;
  const font: CorosWatchfaceRasterFont = current.rasterFont ?? { label: "AM/PM pictures", dataUrl: "", glyphs: "", columns: 1, tint: false };
  return {
    ...design,
    ampmIndicator: {
      ...current,
      fontFamily: undefined,
      rasterFont: {
        ...font,
        // A valid image keeps the saved design valid; no glyphs point into it.
        dataUrl: font.dataUrl || art.dataUrl,
        sprites: { ...font.sprites, [which]: art.dataUrl },
        spriteSizes: { ...font.spriteSizes, [which]: { width: art.width, height: art.height } },
      },
    },
  };
}

/** Back to the template's AM and PM. */
export function resetAmPmPictures(design: Design): Design {
  return design.ampmIndicator?.rasterFont ? { ...design, ampmIndicator: { ...design.ampmIndicator, rasterFont: undefined } } : design;
}

export function AmPmPictures({ design, edit, fail }: { design: Design; edit: Edit; fail: (e: unknown) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [which, setWhich] = useState<AmPm>("AM");
  const pictures = design.ampmIndicator?.rasterFont?.sprites ?? {};
  if (!design.ampmIndicator) return null;
  return (
    <div className="st-ampm">
      <div className="st-ampm-row" role="group" aria-label={t("AM and PM pictures")}>
        {(["AM", "PM"] as const).map((label) => (
          <button key={label} type="button" className="st-ampm-pic" aria-label={t("Replace the {label} picture", { label })} onClick={() => { setWhich(label); input.current?.click(); }}>
            <span className="st-ampm-prev" data-checker="">{pictures[label] ? <img src={pictures[label]} alt="" /> : <b>{label}</b>}</span>
            <span className="st-ampm-copy"><b>{label}</b><small>{pictures[label] ? t("Yours") : t("Template")}</small></span>
            <Icon name="upload" size={15} />
          </button>
        ))}
      </div>
      {pictures.AM || pictures.PM ? (
        <button type="button" className="chip st-chip-btn" onClick={() => edit(resetAmPmPictures)}><Icon name="refresh" size={15} />{t("Use the template's")}</button>
      ) : <span className="st-note">{t("AM shows before noon and PM after, in 12-hour mode.")}</span>}
      <input ref={input} type="file" hidden accept="image/png" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (f) void readArtwork(f).then((art) => edit((x) => setAmPmPicture(x, which, art))).catch(fail);
      }} />
    </div>
  );
}
