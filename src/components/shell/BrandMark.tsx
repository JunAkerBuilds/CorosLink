import Image from "next/image";
import "./BrandMark.css";

/** The C-LINK mark (the app icon's transparent "C"), used before the wordmark in the header. Decorative. */
export function BrandMark() {
  return <Image className="brand-mark" src="/img/clink-mark.png" alt="" aria-hidden="true" width={81} height={88} priority />;
}
