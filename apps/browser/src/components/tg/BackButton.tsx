import { useNavigate } from "react-router-dom";

import { useI18n } from "@/core/i18n/context";
import styles from "./BackButton.module.css";

/**
 * «← Back» pill: history-back when there is somewhere to go back to,
 * otherwise the fallback path. Same behavior as the HelpPane back button.
 */
export function BackButton({ fallback }: { fallback: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={styles.back}
      onClick={() => {
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate(fallback);
      }}
    >
      ← {t.common.back}
    </button>
  );
}