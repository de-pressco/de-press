import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { AccountMenuContext } from "@/components/layout/Shell";
import { ListRow } from "@/components/tg/ListRow";
import { useI18n } from "@/core/i18n/context";
import { usePwaInstall } from "@/core/hooks/usePwaInstall";
import { FundCard } from "@/features/fund/FundCard";
import { TipWalletForm } from "@/features/fund/TipWalletForm";
import { NotifySettingsCard } from "@/features/notifications/NotifySettingsCard";
import styles from "./SettingsPane.module.css";

export function SettingsPane() {
  const { t } = useI18n();
  const account = useContext(AccountMenuContext);
  const pwa = usePwaInstall();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });
  const isHelper = Boolean(meQuery.data?.is_helper);

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t.nav.settings}</h1>
      </header>
      <div className={styles.list}>
        <ListRow
          asButton
          title={t.nav.account}
          avatarText="@"
          onClick={() => account?.open()}
        />
        <NotifySettingsCard isHelper={isHelper} />
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
