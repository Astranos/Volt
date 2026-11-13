import { Facet } from "@codemirror/state";

export type IconFor = (name: string) => Node | null;

/** Where the menus get their icons: SVGs cloned from icons React rendered. */
export const noteIcons = Facet.define<IconFor, IconFor>({ combine: (values) => values[0] ?? (() => null) });
