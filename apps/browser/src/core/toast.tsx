import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/core/i18n/context";
import { useFocusTrap, useInertBackground } from "@/core/hooks/useFocusTrap";
import styles from "./toast.module.css";

export type ToastTone = "info" | "danger";

export interface ChooseAction<T extends string = string> {
  id: T;
  label: string;
  danger?: boolean;
}

interface ChooseOpts<T extends string> {
  message: string;
  actions: ChooseAction<T>[];
  cancelLabel: string;
}

interface ConfirmOpts {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

interface ModalState {
  message: string;
  actions: ChooseAction[];
  cancelLabel: string;
  resolve: (value: string | null) => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  choose: <T extends string>(opts: ChooseOpts<T>) => Promise<T | null>;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const seq = useRef(1);
  const modalRef = useRef<ModalState | null>(null);
  modalRef.current = modal;
  const cardRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(cardRef, modal !== null);
  useInertBackground(cardRef, modal !== null);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = seq.current++;
      setItems((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const choose = useCallback(
    <T extends string>(opts: ChooseOpts<T>): Promise<T | null> => {
      if (modalRef.current) return Promise.resolve(null);
      return new Promise((resolve) => {
        const state: ModalState = {
          message: opts.message,
          actions: opts.actions,
          cancelLabel: opts.cancelLabel,
          resolve: (value) => resolve(value as T | null),
        };
        modalRef.current = state;
        setModal(state);
      });
    },
    [],
  );

  const closeModal = useCallback((value: string | null) => {
    const current = modalRef.current;
    if (!current) return;
    modalRef.current = null;
    setModal(null);
    current.resolve(value);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOpts) => {
      return choose({
        message: opts.message,
        actions: [
          {
            id: "yes",
            label: opts.confirmLabel,
            danger: opts.danger,
          },
        ],
        cancelLabel: opts.cancelLabel,
      }).then((pick) => pick === "yes");
    },
    [choose],
  );

  useEffect(() => {
    if (!modal) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal, closeModal]);

  const api = useMemo(() => ({ show, confirm, choose }), [show, confirm, choose]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.host} aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={
              item.tone === "danger"
                ? `${styles.toast} ${styles.danger}`
                : styles.toast
            }
            role="status"
          >
            <p className={styles.msg}>{item.message}</p>
            <button
              type="button"
              className={styles.x}
              onClick={() => dismiss(item.id)}
              aria-label={t.common.close}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {modal ? (
        <div
          className={styles.backdrop}
          role="presentation"
          onClick={() => closeModal(null)}
        >
          <div
            ref={cardRef}
            className={styles.card}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p className={styles.modalMsg}>{modal.message}</p>
            <div className={styles.stack}>
              {modal.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={
                    a.danger
                      ? `${styles.btnBlock} ${styles.btnDanger}`
                      : styles.btnBlock
                  }
                  onClick={() => closeModal(a.id)}
                >
                  {a.label}
                </button>
              ))}
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => closeModal(null)}
              >
                {modal.cancelLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
