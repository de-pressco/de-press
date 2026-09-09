import { Outlet } from "react-router-dom";
import { useI18n } from "@/core/i18n/context";
import { AntiPanicOverlay } from "@/features/anti-panic/AntiPanicOverlay";
import { Sidebar } from "./Sidebar";
import styles from "./Shell.module.css";

export function Shell() {
  const { t } = useI18n();
  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        {t.nav.skipToContent}
      </a>
      <Sidebar />
      <main id="main" className={styles.content}>
        <Outlet />
      </main>
      <AntiPanicOverlay />
    </div>
  );
}
