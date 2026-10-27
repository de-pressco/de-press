import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { AccountMenuContext } from "@/components/layout/Shell";
import { ListRow } from "@/components/tg/ListRow";
import { useI18n } from "@/core/i18n/context";
import { usePwaInstall } from "@/core/hooks/usePwaInstall";
import { FundCard } from "@/features/fund/FundCard";
import { TipWalletForm } from "@/features/fund/TipWalletForm";
import { BugReport } from "@/features/more/BugReport";
import { QuickCheckin } from "@/features/more/QuickCheckin";
import styles from "./MorePane.module.css";

export function MorePane() {
  const { t } = useI18n();
  const account = useContext(AccountMenuContext);
  const pwa = usePwaInstall();
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
        {isHelper ? (
          <ListRow to="/helper" title={t.nav.helper} avatarText="H" />
        ) : null}
        {isStaff ? (
          <ListRow
            asButton
            title={t.helper.dashboardTitle}
            subtitle={t.helper.dashboardLead}
            avatarText="M"
            onClick={() => window.location.assign("/console/")}
          />
        ) : null}
        <ListRow
          asButton
          title={t.nav.account}
          avatarText="@"
          onClick={() => account?.open()}
        />
        <BugReport />
        <FundCard />
        {isHelper ? (
          <TipWalletForm
            current={meQuery.data?.tip_wallet_address ?? ""}
            verified={meQuery.data?.tip_wallet_verified ?? false}
          />
        ) : null}
        {pwa.isStandalone ? (
          <ListRow asButton title={t.nav.installed} avatarText="·" muted />
        ) : pwa.canInstall ? (
          <ListRow
            asButton
            title={t.nav.install}
            avatarText="↓"
            onClick={() => void pwa.prompt()}
          />
        ) : pwa.isIos ? (
          <ListRow
            asButton
            title={t.nav.install}
            subtitle={t.nav.installIos}
            avatarText="↓"
            muted
          />
        ) : null}
      </div>
    </div>
  );
}
