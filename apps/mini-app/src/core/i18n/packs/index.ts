/**
 * Static UI packs for machine locales — one JSON chunk per language, loaded on
 * demand so the main bundle only carries `en` (+ `ru`). Regenerate with
 * `node scripts/gen_i18n_packs.mjs` after changing en/ru copy.
 */
type PackLoader = () => Promise<Record<string, string>>;

export const PACKS: Record<string, PackLoader> = {
  es: () => import("./es.json").then((m) => m.default),
  uk: () => import("./uk.json").then((m) => m.default),
  be: () => import("./be.json").then((m) => m.default),
  kk: () => import("./kk.json").then((m) => m.default),
  uz: () => import("./uz.json").then((m) => m.default),
  hy: () => import("./hy.json").then((m) => m.default),
  ka: () => import("./ka.json").then((m) => m.default),
  az: () => import("./az.json").then((m) => m.default),
  tg: () => import("./tg.json").then((m) => m.default),
  de: () => import("./de.json").then((m) => m.default),
  fr: () => import("./fr.json").then((m) => m.default),
  pt: () => import("./pt.json").then((m) => m.default),
  it: () => import("./it.json").then((m) => m.default),
  nl: () => import("./nl.json").then((m) => m.default),
  pl: () => import("./pl.json").then((m) => m.default),
  cs: () => import("./cs.json").then((m) => m.default),
  sk: () => import("./sk.json").then((m) => m.default),
  hu: () => import("./hu.json").then((m) => m.default),
  ro: () => import("./ro.json").then((m) => m.default),
  bg: () => import("./bg.json").then((m) => m.default),
  el: () => import("./el.json").then((m) => m.default),
  tr: () => import("./tr.json").then((m) => m.default),
  sv: () => import("./sv.json").then((m) => m.default),
  da: () => import("./da.json").then((m) => m.default),
  fi: () => import("./fi.json").then((m) => m.default),
  no: () => import("./no.json").then((m) => m.default),
  ar: () => import("./ar.json").then((m) => m.default),
  he: () => import("./he.json").then((m) => m.default),
  fa: () => import("./fa.json").then((m) => m.default),
  ur: () => import("./ur.json").then((m) => m.default),
  hi: () => import("./hi.json").then((m) => m.default),
  bn: () => import("./bn.json").then((m) => m.default),
  id: () => import("./id.json").then((m) => m.default),
  vi: () => import("./vi.json").then((m) => m.default),
  th: () => import("./th.json").then((m) => m.default),
  ja: () => import("./ja.json").then((m) => m.default),
  ko: () => import("./ko.json").then((m) => m.default),
  zh: () => import("./zh.json").then((m) => m.default),
  sw: () => import("./sw.json").then((m) => m.default),
};

export async function loadPack(code: string): Promise<Record<string, string> | null> {
  const loader = PACKS[code];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}
