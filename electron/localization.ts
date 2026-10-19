import { app, Menu, type OpenDialogOptions, type SaveDialogOptions, type MessageBoxOptions } from "electron";
import { getSetting, setSetting } from "./database";

import { preferredLanguage, supportedLanguage, type Language } from "./appLanguage";
import { nativeChinese } from "./localizationChinese";
import { nativePortuguese } from "./localizationPortuguese";
let language: Language = "en";
const french: Record<string, string> = {
  "File": "Fichier", "Edit": "Édition", "View": "Affichage", "Window": "Fenêtre", "Help": "Aide",
  "About CorosLink": "À propos de CorosLink", "Quit CorosLink": "Quitter CorosLink",
  "Hide CorosLink": "Masquer CorosLink", "Hide Others": "Masquer les autres", "Show All": "Tout afficher",
  "Undo": "Annuler", "Redo": "Rétablir", "Cut": "Couper", "Copy": "Copier", "Paste": "Coller",
  "Select All": "Tout sélectionner", "Close": "Fermer", "Minimize": "Réduire", "Zoom": "Agrandir",
  "Reload": "Recharger", "Toggle Developer Tools": "Afficher les outils de développement",
  "Actual Size": "Taille réelle", "Zoom In": "Zoom avant", "Zoom Out": "Zoom arrière", "Toggle Full Screen": "Plein écran",
  "Cancel": "Annuler", "Open": "Ouvrir", "Save": "Enregistrer", "Delete from watch": "Supprimer de la montre",
  "Remove watch key": "Supprimer la clé de la montre",
  "Remove the COROS watch key from this computer?": "Supprimer la clé de la montre COROS de cet ordinateur ?",
  "This removes the MP3 from your watch over Bluetooth. It cannot be undone. Your local library is kept.": "Le MP3 sera supprimé de votre montre par Bluetooth. Cette action est irréversible. Votre bibliothèque locale est conservée.",
  "CorosLink won't authenticate with your watch again until you sign in to COROS. A watch that's connected now stays connected until you disconnect it. C-LINK keeps its own copy on your iPhone.": "CorosLink ne pourra plus s’authentifier auprès de votre montre avant une nouvelle connexion à COROS. Une montre déjà connectée le reste jusqu’à sa déconnexion. C-LINK conserve sa propre copie sur votre iPhone.",
  "Send MP3s to watch podcasts over Wi-Fi": "Envoyer des MP3 vers les podcasts de la montre par Wi-Fi",
  "MP3 audio": "Audio MP3",
  "Choose a current watch download-settings backup": "Choisir une sauvegarde récente des paramètres de téléchargement de la montre",
  "CorosLink encrypted Wi-Fi settings": "Paramètres Wi-Fi chiffrés CorosLink",
  "Choose a compiled COROS watch face": "Choisir un cadran COROS compilé",
  "Compiled watch face": "Cadran compilé",
  "Compile a custom watch face to BIN": "Compiler un cadran personnalisé au format BIN",
  "Final watch face DAT/ZIP": "Cadran final DAT/ZIP",
  "Save compiled watch face BIN": "Enregistrer le cadran BIN compilé",
  "Compiled watch face BIN": "Cadran BIN compilé",
  "Choose a COROS custom watchface archive": "Choisir une archive de cadran COROS personnalisé",
  "Watchface archive": "Archive de cadran",
  "Choose watchface artwork": "Choisir l’illustration du cadran",
  "Images": "Images", "Choose a PNG watchface sprite folder": "Choisir un dossier de sprites PNG pour le cadran",
  "Export editable watch face for website": "Exporter le cadran modifiable pour le site web",
  "Watch-face ZIP archive": "Archive ZIP de cadran",
  "Export final watch-face ZIP": "Exporter le cadran final au format ZIP",
  "Final watch-face ZIP": "Cadran final ZIP",
  "Choose a folder for the watch-face ZIPs": "Choisir un dossier pour les cadrans ZIP",
  "Export here": "Exporter ici", "Choose a backup folder": "Choisir un dossier de sauvegarde",
  "Choose an audiobook (select several files to join them)": "Choisir un livre audio (sélectionnez plusieurs fichiers pour les réunir)",
  "Audiobook": "Livre audio",
  "Export GPX": "Exporter le GPX", "Import GPX route": "Importer un itinéraire GPX",
};

export function nativeText(source: string): string {
  if (language === "en") return source;
  const messages = language === "zh-CN" ? nativeChinese : language === "pt" ? nativePortuguese : french;
  if (Object.hasOwn(messages, source)) return messages[source];
  const removal = /^Delete “([\s\S]*)” from the watch\?$/.exec(source);
  if (removal) return { fr: `Supprimer « ${removal[1]} » de la montre ?`, pt: `Eliminar «${removal[1]}» do relógio?`, "zh-CN": `要从手表中删除“${removal[1]}”吗？` }[language];
  const fileType = /^([A-Z0-9]+) file$/.exec(source);
  return fileType ? { fr: `Fichier ${fileType[1]}`, pt: `Ficheiro ${fileType[1]}`, "zh-CN": `${fileType[1]} 文件` }[language] : source;
}

/** Localize presentation only; paths, file extensions and response indexes stay stable. */
export function localizeDialogOptions<T extends OpenDialogOptions | SaveDialogOptions | MessageBoxOptions>(options: T): T {
  const result = { ...options };
  for (const key of ["title", "message", "detail", "buttonLabel", "checkboxLabel"] as const) {
    const value = (options as Record<string, unknown>)[key];
    if (typeof value === "string") (result as Record<string, unknown>)[key] = nativeText(value);
  }
  if ("buttons" in options && options.buttons) (result as MessageBoxOptions).buttons = options.buttons.map(nativeText);
  if ("filters" in options && options.filters) (result as OpenDialogOptions).filters = options.filters.map(filter => ({ ...filter, name: nativeText(filter.name) }));
  if (!("buttons" in options)) {
    const fileOptions = result as OpenDialogOptions;
    fileOptions.buttonLabel ??= nativeText("properties" in options ? "Open" : "Save");
  }
  return result;
}

function updateApplicationMenu(): void {
  const role = (role: Electron.MenuItemConstructorOptions["role"], label: string): Electron.MenuItemConstructorOptions => ({ role, label: nativeText(label) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ label: "CorosLink", submenu: [
      role("about", "About CorosLink"), { type: "separator" as const },
      role("hide", "Hide CorosLink"), role("hideOthers", "Hide Others"), role("unhide", "Show All"),
      { type: "separator" as const }, role("quit", "Quit CorosLink"),
    ] }] : []),
    { label: nativeText("File"), submenu: [role("close", "Close"), ...(process.platform !== "darwin" ? [role("quit", "Quit CorosLink")] : [])] },
    { label: nativeText("Edit"), submenu: [role("undo", "Undo"), role("redo", "Redo"), { type: "separator" }, role("cut", "Cut"), role("copy", "Copy"), role("paste", "Paste"), role("selectAll", "Select All")] },
    { label: nativeText("View"), submenu: [role("reload", "Reload"), role("toggleDevTools", "Toggle Developer Tools"), { type: "separator" }, role("resetZoom", "Actual Size"), role("zoomIn", "Zoom In"), role("zoomOut", "Zoom Out"), role("togglefullscreen", "Toggle Full Screen")] },
    { label: nativeText("Window"), submenu: [role("minimize", "Minimize"), role("zoom", "Zoom"), role("close", "Close")] },
  ]));
}

export function initializeNativeLanguage(): void {
  language = supportedLanguage(getSetting("app.language")) ?? preferredLanguage(app.getPreferredSystemLanguages());
  updateApplicationMenu();
}

export function setNativeLanguage(value: unknown): void {
  if (value !== "en" && value !== "fr" && value !== "pt" && value !== "zh-CN") throw new Error("Unsupported app language.");
  language = value;
  setSetting("app.language", language);
  updateApplicationMenu();
}
