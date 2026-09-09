import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/core/api/client";
import { friendlyError } from "@/core/api/errorCopy";
import type { Dialogue } from "@/core/api/types";
import { useI18n } from "@/core/i18n/context";
import { useToast } from "@/core/toast";

interface DialogueActionOpts {
  onUpdated?: (d: Dialogue) => void;
  onCleared?: (id: string) => void;
  onRemoved?: (id: string) => void;
}

export function useDialogueActions(opts: DialogueActionOpts = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id: openId } = useParams<{ id?: string }>();

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["dialogues"] });
  }

  function fail(err: unknown) {
    toast.show(friendlyError(err, t.common.errorSoft), "danger");
  }

  async function apply(fn: () => Promise<Dialogue>) {
    try {
      const d = await fn();
      opts.onUpdated?.(d);
      await refresh();
      return d;
    } catch (err) {
      fail(err);
      return null;
    }
  }

  return {
    pin: (d: Dialogue) => apply(() => api.pinChat(d.id)),
    unpin: (d: Dialogue) => apply(() => api.unpinChat(d.id)),
    mute: (d: Dialogue) => apply(() => api.muteDialogue(d.id)),
    unmute: (d: Dialogue) => apply(() => api.unmuteDialogue(d.id)),
    markUnread: (d: Dialogue) => apply(() => api.markDialogueUnread(d.id)),
    markRead: (d: Dialogue) => apply(() => api.markDialogueRead(d.id)),

    async clearHistory(d: Dialogue) {
      const pick = await toast.choose({
        message: t.chat.clearHistoryConfirm,
        actions: [
          { id: "me", label: t.chat.deleteForMe },
          { id: "everyone", label: t.chat.deleteForEveryone, danger: true },
        ],
        cancelLabel: t.chat.confirmNo,
      });
      if (!pick) return;
      const next = await apply(() => api.clearHistory(d.id, pick));
      if (next) {
        toast.show(t.chat.clearHistoryDone);
        opts.onCleared?.(d.id);
      }
    },

    async block(d: Dialogue) {
      const ok = await toast.confirm({
        message: t.chat.hidePeerConfirm,
        confirmLabel: t.chat.confirmBlock,
        cancelLabel: t.common.cancel,
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.blockPeerInDialogue(d.id);
        await api.closeDialogue(d.id);
        toast.show(res.message);
        const next = { ...d, peer_hidden: true, status: "closed" };
        opts.onUpdated?.(next);
        await refresh();
      } catch (err) {
        fail(err);
      }
    },

    async unblock(d: Dialogue) {
      try {
        const res = await api.unblockPeerInDialogue(d.id);
        toast.show(res.message || t.chat.unhidePeerDone);
        opts.onUpdated?.({ ...d, peer_hidden: false });
        await refresh();
      } catch (err) {
        fail(err);
      }
    },

    async remove(d: Dialogue) {
      const pick = await toast.choose({
        message: t.chat.deleteChatConfirm,
        actions: [
          { id: "me", label: t.chat.deleteForMe },
          { id: "everyone", label: t.chat.deleteForEveryone, danger: true },
        ],
        cancelLabel: t.chat.confirmNo,
      });
      if (!pick) return;
      try {
        await api.deleteDialogue(d.id, pick);
        toast.show(t.chat.deleteChatDone);
        await refresh();
        opts.onRemoved?.(d.id);
        if (openId === d.id) navigate("/chat", { replace: true });
      } catch (err) {
        fail(err);
      }
    },
  };
}

export type DialogueActions = ReturnType<typeof useDialogueActions>;
