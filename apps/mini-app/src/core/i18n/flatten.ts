import type { Messages } from "./types";

export function fmt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  );
}

export function flattenMessages(input: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input === "string") {
    if (prefix) out[prefix] = input;
    return out;
  }
  if (Array.isArray(input)) {
    input.forEach((item, i) => {
      Object.assign(out, flattenMessages(item, prefix ? `${prefix}.${i}` : String(i)));
    });
    return out;
  }
  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      Object.assign(out, flattenMessages(value, path));
    }
  }
  return out;
}

export function applyFlat(
  base: Messages,
  flat: Record<string, string>,
): Messages {
  const copy = cloneTree(base) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(flat)) {
    setPath(copy, path.split("."), value);
  }
  return copy as unknown as Messages;
}

/** structuredClone() throws on the function leaves this catalog carries
 *  (chat.statusReconnect); copy trees by hand and keep callables by reference. */
function cloneTree<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneTree) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneTree(inner);
    }
    return out as T;
  }
  return value;
}

function setPath(obj: Record<string, unknown>, parts: string[], value: string): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (Array.isArray(next)) {
      cur = next as unknown as Record<string, unknown>;
      continue;
    }
    if (!next || typeof next !== "object") {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  cur[last] = value;
}

export function catalogHash(flat: Record<string, string>): string {
  const json = JSON.stringify(flat);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}