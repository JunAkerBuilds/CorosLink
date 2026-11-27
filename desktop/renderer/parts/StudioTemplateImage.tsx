// A template image's own picture and facts in the inspector (AM, PM, colons, minus signs, thumbnail, slot icons,
// hands…): the picture the face uses (yours, or the template's at its largest screen), Download to edit it elsewhere,
// and its size, file and config key with what the watch does with it. CorosLink's config asset inspector.
import { useEffect, useState } from "react";
import type { CorosWatchfaceTemplateDetails, CorosWatchfaceTemplateAsset } from "../../watchface/types";
import { largestWatchfaceConfigAssetSource, listWatchfaceConfigAssets, type WatchfaceConfigAssetReference } from "../../watchface/engine/watchfaceStudio";
import { t } from "@/lib/i18n";
import { Icon } from "./StudioIcon";

/** The template's reference for a config asset id (`config:colon_icon`, `aod:…`), or null. */
export function templateImageOf(details: CorosWatchfaceTemplateDetails, configAssetId: string | undefined): WatchfaceConfigAssetReference | null {
  if (!configAssetId) return null;
  const all = listWatchfaceConfigAssets(details, undefined, [], true);
  // On the always-on screen the details are already the always-on ones, so its ids may read config:.
  const key = configAssetId.slice(configAssetId.indexOf(":") + 1);
  return all.find((r) => r.id === configAssetId) ?? all.find((r) => r.configKey === key) ?? null;
}

/** What the watch does with a template image, where that isn't obvious (CorosLink's words, shortened). */
export function templateImageRole(configKey: string): string | null {
  switch (configKey) {
    case "time_hour_icon": return t("Turns as the hour hand. Its centre is the pivot: draw it pointing up.");
    case "time_minute_icon": return t("Turns as the minute hand. Its centre is the pivot: draw it pointing up.");
    case "time_second_icon": return t("Turns as the second hand. Its centre is the pivot: draw it pointing up.");
    case "time_center_polygon_icon1": return t("Sits on top of the hour and minute hands.");
    case "time_center_polygon_icon2": return t("Sits on top of every hand.");
    case "colon_icon": return t("Placed between the hour and minute digits.");
    case "control_colon_icon": return t("Placed between two-part values in the selectable slot.");
    case "watchface_thmb_icon": return t("The face's thumbnail in lists. Not drawn on the watch.");
    case "negative_sign_icon": return t("Drawn as -- when sleep score or stress has no reading.");
    case "control_negative_sign_icon": return t("Drawn before a value below zero.");
    default: return configKey.startsWith("control_") ? t("Shows while this type is picked in the selectable slot.") : null;
  }
}

type LoadAssets = (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>;

/** The template's own copy of the picture at its largest screen (CorosLink's Download source). */
function useTemplatePicture(details: CorosWatchfaceTemplateDetails, reference: WatchfaceConfigAssetReference | null, loadAssets?: LoadAssets) {
  const source = reference ? largestWatchfaceConfigAssetSource(details, reference) ?? reference.source : null;
  const path = source?.path ?? "";
  const [got, setGot] = useState<{ path: string; asset: CorosWatchfaceTemplateAsset } | null>(null);
  useEffect(() => {
    if (!path || !loadAssets) return;
    let live = true;
    void loadAssets([path]).then(([asset]) => { if (live && asset) setGot({ path, asset }); }).catch(() => undefined);
    return () => { live = false; };
  }, [path, loadAssets]);
  return got?.path === path ? got.asset : null;
}

function save(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "image"}.png`;
  a.click();
}

/** The picture beside the image actions: the replacement, else the template's own. */
export function TemplatePicture({ details, configAssetId, replacement, loadAssets }: {
  details: CorosWatchfaceTemplateDetails; configAssetId?: string; replacement?: string; loadAssets?: LoadAssets;
}) {
  const reference = templateImageOf(details, configAssetId);
  const template = useTemplatePicture(details, replacement ? null : reference, loadAssets);
  const url = replacement ?? template?.dataUrl;
  return <span className="st-img-prev">{url ? <img src={url} alt="" /> : <Icon name="image" size={22} />}</span>;
}

/** Download, and the image's size, file, config key and what the watch does with it. */
export function TemplateImageFacts({ details, configAssetId, label, replacement, loadAssets }: {
  details: CorosWatchfaceTemplateDetails; configAssetId?: string; label: string; replacement?: { dataUrl: string; width: number; height: number }; loadAssets?: LoadAssets;
}) {
  const reference = templateImageOf(details, configAssetId);
  const template = useTemplatePicture(details, reference, loadAssets);
  if (!reference) return null;
  const shown = replacement ?? template;
  const role = templateImageRole(reference.configKey);
  return (
    <div className="st-tpl-facts">
      {shown ? (
        <button type="button" className="chip st-chip-btn" onClick={() => save(shown.dataUrl, `${label} ${shown.width}x${shown.height}`)}>
          <Icon name="download" size={15} />{t("Download")}</button>
      ) : null}
      <dl>
        {shown ? <><dt>{t("Size")}</dt><dd>{shown.width} × {shown.height} px</dd></> : null}
        <dt>{t("File")}</dt><dd><code>{reference.relativePath || "—"}</code></dd>
        <dt>{t("Key")}</dt><dd><code>[{reference.configKey}]</code></dd>
      </dl>
      {role ? <span className="st-note">{role}</span> : null}
      {!reference.source ? <span className="st-note">{t("Not in the template. Adding an image adds [{key}] to {file}.", { key: reference.configKey, file: reference.scope === "aod" ? "AODconfig.txt" : "config.txt" })}</span> : null}
    </div>
  );
}
