#!/usr/bin/env node
/**
 * Regenerate static UI packs for machine locales:
 *   apps/{browser,mini-app}/src/core/i18n/packs/<lang>.json
 *
 * Source of truth is still messages/en.ts (+ ru.ts handwritten). Every other
 * picker language is a flat key -> string pack generated here, then merged over
 * `en` at runtime by applyFlat(). Re-run when en/ru copy changes.
 *
 *   node scripts/gen_i18n_packs.mjs          # all machine languages
 *   node scripts/gen_i18n_packs.mjs de fr    # only these
 *
 * Endpoint: AI_BASE_URL / AI_MODEL / AI_API_KEY (or DEEPSEEK_API_KEY) — the
 * same variables the backend reads.
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["browser", "mini-app"];
const require = createRequire(import.meta.url);

/** Picker locales that ship a pack (ru/en are handwritten). */
const LANGS = {
  es: "Spanish",
  uk: "Ukrainian",
  be: "Belarusian",
  kk: "Kazakh",
  uz: "Uzbek",
  hy: "Armenian",
  ka: "Georgian",
  az: "Azerbaijani",
  tg: "Tajik",
  de: "German",
  fr: "French",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  cs: "Czech",
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  el: "Greek",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  ur: "Urdu",
  hi: "Hindi",
  bn: "Bengali",
  id: "Indonesian",
  vi: "Vietnamese",
  th: "Thai",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  sw: "Swahili",
};

const BASE = (process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = process.env.AI_MODEL || "deepseek-chat";
const KEY = (process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim();
/** Terminology the model gets wrong from English alone (per locale). */
const GLOSSARY = {
  ar: { "التغذية": "المنشورات" }, // "Feed" is the stories list, not nutrition
};

const CHUNK = 50;
const LANGS_IN_FLIGHT = 3;
const CHUNKS_IN_FLIGHT = 4;
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = (wanted.length ? wanted : Object.keys(LANGS)).map((code) => {
  if (!LANGS[code]) throw new Error(`unknown language: ${code}`);
  return code;
});

function flatten(input, prefix = "", out = {}) {
  if (typeof input === "string") {
    if (prefix) out[prefix] = input;
    return out;
  }
  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** Load an app's English catalog as a flat map (esbuild → temp CJS → require). */
async function loadCatalog(app) {
  const esbuild = require(
    require.resolve("esbuild", { paths: [join(ROOT, "apps", app)] }),
  );
  const dir = mkdtempSync(join(tmpdir(), `i18n-${app}-`));
  const outfile = join(dir, "en.cjs");
  esbuild.buildSync({
    entryPoints: [join(ROOT, "apps", app, "src/core/i18n/messages/en.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "silent",
  });
  return flatten(require(outfile).en);
}

async function translateChunk(langName, code, strings) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    // A hung socket must not stall the whole run.
    signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You localize the interface of de-press, a calm peer-support app for mental health. " +
            "Translate every value into the target language, including single words and short " +
            "labels like 'Feed' or 'Chats' — never leave an English word untranslated unless it " +
            "is the brand 'de-press', the feature name 'Anti-Panic', or a proper name. Use the " +
            "standard UI terminology of that language. Context: 'Feed' is the list of published " +
            "stories (a social feed, not food), 'Patterns' are the user's private mood notes, " +
            "'Chats' are private dialogues with story authors. Keep placeholders like {count} exactly as " +
            "written, keep emoji and punctuation, and keep empty values empty. Use a warm, " +
            "informal, non-clinical tone; never add advice, diagnosis or explanations. " +
            "Reply with a JSON object only, same keys, translated values.",
        },
        {
          role: "user",
          content:
            `Target language: ${langName} (${code}).\n` +
            `Translate the values of this JSON object, keys unchanged:\n` +
            JSON.stringify(strings),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || "").trim();
  const text = raw.replace(/^```(?:json)?\s*|```$/g, "");
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

  const out = {};
  const bad = {};
  for (const [key, source] of Object.entries(strings)) {
    if (!source.trim()) {
      out[key] = source; // intentionally empty source stays empty
      continue;
    }
    const value = parsed[key];
    const want = [...(source.match(PLACEHOLDER) || [])].sort().join(",");
    const got = [...((typeof value === "string" && value.match(PLACEHOLDER)) || [])]
      .sort()
      .join(",");
    if (typeof value !== "string" || !value.trim() || want !== got) {
      bad[key] = source;
      continue;
    }
    out[key] = value.trim();
  }
  return { out, bad };
}

/** Network/parse retry for one request (missing keys are handled by the caller). */
async function translateOnce(langName, code, strings) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await translateChunk(langName, code, strings);
    } catch (err) {
      lastError = err;
      console.warn(`  ~ ${code} attempt ${attempt}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
}

/** Translate a chunk, then re-ask only for the keys the model skipped so a
 *  single dropped string never costs the whole chunk. */
async function translateChunkWithRetry(langName, code, strings) {
  const done = {};
  let pending = strings;
  for (let round = 1; round <= 4; round++) {
    const { out, bad } = await translateOnce(langName, code, pending);
    Object.assign(done, out);
    if (!Object.keys(bad).length) break;
    pending = bad;
  }
  const left = Object.keys(pending).filter((k) => !(k in done));
  if (left.length) console.warn(`  ! ${code}: kept English for ${left.join(", ")}`);
  return { ...strings, ...done };
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

async function main() {
  if (!KEY) throw new Error("AI_API_KEY / DEEPSEEK_API_KEY is not set");
  const catalogs = {};
  for (const app of APPS) {
    catalogs[app] = await loadCatalog(app);
    mkdirSync(join(ROOT, "apps", app, "src/core/i18n/packs"), { recursive: true });
  }
  const union = { ...catalogs.browser, ...catalogs["mini-app"] };
  const keys = Object.keys(union).sort();
  console.log(`catalog: union=${keys.length}, langs=${targets.length}, model=${MODEL}`);

  const started = Date.now();
  let done = 0;
  await pool(targets, LANGS_IN_FLIGHT, async (code) => {
    const t0 = Date.now();
    const chunks = [];
    for (let i = 0; i < keys.length; i += CHUNK) {
      chunks.push(Object.fromEntries(keys.slice(i, i + CHUNK).map((k) => [k, union[k]])));
    }
    const parts = await pool(chunks, CHUNKS_IN_FLIGHT, (strings) =>
      translateChunkWithRetry(LANGS[code], code, strings),
    );
    const flat = Object.assign({}, ...parts);
    for (const [from, to] of Object.entries(GLOSSARY[code] || {})) {
      for (const key of Object.keys(flat)) flat[key] = flat[key].split(from).join(to);
    }
    for (const app of APPS) {
      const own = {};
      for (const key of Object.keys(catalogs[app])) own[key] = flat[key];
      writeFileSync(
        join(ROOT, "apps", app, "src/core/i18n/packs", `${code}.json`),
        `${JSON.stringify(own, null, 2)}\n`,
      );
    }
    done += 1;
    console.log(
      `[${done}/${targets.length}] ${code} (${LANGS[code]}) in ${(
        (Date.now() - t0) / 1000
      ).toFixed(0)}s`,
    );
  });
  console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
