import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api } from "../core/api/client";
import { useI18n } from "../core/i18n/context";

/**
 * Own shift in the moderation window: `/console/` and `/helper` are two doors
 * of the same Helper role, so a moderator goes on duty from here as well.
 */
export function Shift({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    retry: false,
  });

  const duty = useMutation({
    mutationFn: (on: boolean) => api.setDuty(on),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-helpers"] });
    },
  });

  useEffect(() => {
    if (me.isError) onError(me.error);
  }, [me.isError, me.error, onError]);

  if (!me.data) return null;

  const onDuty = Boolean(me.data.is_on_duty);

  return (
    <div className="shift">
      <span
        className={onDuty ? "shift-dot shift-dot-on" : "shift-dot"}
        aria-hidden
      />
      <span className="shift-label">
        {onDuty ? t.helpers.onDuty : t.helpers.offDuty}
      </span>
      <button
        type="button"
        className="tab"
        disabled={duty.isPending}
        aria-pressed={onDuty}
        onClick={() => duty.mutate(!onDuty)}
      >
        {onDuty ? t.helpers.dutyOff : t.helpers.dutyOn}
      </button>
      {duty.isError ? (
        <span className="err">
          {duty.error instanceof ApiError ? duty.error.message : t.common.error}
        </span>
      ) : null}
    </div>
  );
}