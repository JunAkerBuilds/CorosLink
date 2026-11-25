// A watch face as a round picture: the home page's thumbnails (a project's saved preview or a template's COROS
// picture) and the editor's live drawing, which the engine renders at the 800 master (studioFace.ts). `over` is drawn
// inside the round dial on top of the picture (the editor's drag frames); `onShown` says when a picture is on screen.
import type { ReactNode } from "react";

export function FaceView({ src, size, label, over, onShown, children }: {
  src?: string | null; size: number; label?: string; over?: ReactNode; onShown?: (src: string) => void; children?: ReactNode;
}) {
  return (
    <div className="st-face" style={{ width: size, height: size }} role="img" aria-label={label ?? "Watch face"}>
      <div className="st-dial">
        {src ? <img className="st-face-img" src={src} alt="" loading={onShown ? undefined : "lazy"} draggable={false}
          onLoad={onShown ? (e) => { const img = e.currentTarget, at = img.getAttribute("src") ?? ""; void img.decode().catch(() => {}).then(() => onShown(at)); } : undefined} /> : null}
        {over}
      </div>
      {children}
    </div>
  );
}
