import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { ListRow } from "@/components/tg/ListRow";
import { useI18n } from "@/core/i18n/context";
import { BugReport } from "@/features/more/BugReport";
import { QuickCheckin } from "@/features/more/QuickCheckin";
import styles from "./MorePane.module.css";

export function MorePane() {
  const { t } = useI18n();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });
  const isHelper = Boolean(meQuery.data?.is_helper);
  const isStaff = Boolean(meQuery.data?.is_staff);

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.nav.more}</h1>
      </header>
      <div className={styles.list}>
        <QuickCheckin />
        <ListRow to="/patterns" title={t.nav.patterns} avatarText="P" />
        <ListRow to="/help" title={t.nav.help} avatarText="?" />
        <ListRow to="/therapy" title={t.nav.therapy} avatarText="T" />
        <ListRow to="/settings" title={t.nav.settings} avatarText="⚙" />
        <BugReport />
        {isHelper ? (
          <section className={styles.staff}>
            <p className={styles.staffCaption}>{t.settings.staffSection}</p>
            <ListRow to="/helper" title={t.nav.helper} avatarText="H" />
            {isStaff ? (
              <ListRow
                asButton
                title={t.helper.dashboardTitle}
                subtitle={t.helper.dashboardLead}
                avatarText="M"
                onClick={() => window.location.assign("/console/")}
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
