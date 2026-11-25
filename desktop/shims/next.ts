// `next`: only the Metadata type the screens' layouts declare. Titles are read by the desktop router.
export interface Metadata {
  title?: string | { absolute?: string; default?: string; template?: string };
  description?: string;
}
