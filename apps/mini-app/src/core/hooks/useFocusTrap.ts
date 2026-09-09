import { useEffect, useRef } from "react";

/**
 * Инертный фон: пока `active`, все поддеревья, не содержащие диалог,
 * получают `inert` — вне ловушки фокуса не остаётся живого интерфейса.
 */
export function useInertBackground(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;
    const touched: HTMLElement[] = [];
    const previouslyInert = new Set<HTMLElement>();
    let el: HTMLElement | null = dialog;
    while (el && el !== document.body) {
      const parent: HTMLElement | null = el.parentElement;
      if (!parent) break;
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child === el || child.contains(el)) continue;
        if (child.hasAttribute("inert")) previouslyInert.add(child);
        child.setAttribute("inert", "");
        touched.push(child);
      }
      el = parent;
    }
    return () => {
      for (const node of touched) {
        if (!previouslyInert.has(node)) node.removeAttribute("inert");
      }
    };
  }, [active, ref]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальный фокус-контур: пока `active`, Tab циклится внутри `ref`,
 * при открытии фокус уходит в `initialRef` (или в первый фокусируемый),
 * при закрытии — возвращается к инициатору. Escape не перехватывается:
 * решение о закрытии остаётся за компонентом.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  initialRef?: React.RefObject<HTMLElement | null>,
): void {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = ref.current;

    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null || el === document.activeElement,
          )
        : [];

    const timer = window.setTimeout(() => {
      const initial = initialRef?.current;
      (initial ?? focusables()[0])?.focus();
    }, 0);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Tab" || !node) return;
      const items = focusables();
      if (items.length === 0) return;
      const current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const inside = current != null && node.contains(current);
      if (ev.shiftKey) {
        if (current === items[0] || !inside) {
          ev.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (current === items[items.length - 1] || !inside) {
        ev.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [active, ref, initialRef]);
}