// `next/image` for the desktop app: images are local files, so a plain <img> with the same props.
import type { CSSProperties, ImgHTMLAttributes } from "react";

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  src: string | { src: string };
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
  quality?: number;
  placeholder?: string;
  sizes?: string;
}

export default function Image({ src, fill, priority, unoptimized, quality, placeholder, style, loading, ...rest }: ImageProps) {
  void unoptimized; void quality; void placeholder;
  const fillStyle: CSSProperties | undefined = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style;
  return <img src={typeof src === "string" ? src : src.src} style={fillStyle} loading={priority ? "eager" : loading ?? "lazy"} decoding="async" {...rest} />;
}
