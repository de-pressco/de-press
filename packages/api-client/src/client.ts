/**
 * API-клиент v2 — общий для browser и mini-app (audit Q3): единый origin
 * через Vite proxy, credentials include (Django session cookie SameSite=Lax).
 * Источник истины один — правки делаются здесь, фронтенды реэкспортируют.
 */

import type {
  AuthorStory,
  BlockItem,
  BugReportOut,
  ChatMessage,
  Dialogue,
  DialogueRequest,
  DigestTestResponse,
  EmpathyResponse,
  FeedResponse,
  FundInfo,
  HealthResponse,
  Hearer,
  HelperDashboard,
  HelperInvite,
  HelpPresence,
  HelpRequest,
  InboxOpenResponse,
  IntentOption,
  Me,
  ModerationActionResponse,
  ModerationDashboard,
  NotifySettings,
  NotifySettingsUpdate,
  OutreachResponse,
  PulseResponse,
  QueueCloud,
  QuietPhrase,
  ReportResponse,
  SendCloudResponse,
  Story,
  StoryThread,
  SupportCloud,
  TherapistProfileOut,
  TherapySession,
  Topic,
  TipWalletResponse,
  AiSupportResponse,
  SendCircleOptions,
  VoiceRetentionSettings,
} from "./types";

/** Same-origin relative base (Vite proxies /api, /media, /ws → Django). */
export const API_URL = "";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

async function postStoryVoice(
  path: string,
  blob: Blob,
  opts?: {
    body?: string;
    topic?: string;
    pseudonym?: string;
    durationMs?: number;
    sourceLang?: string;
    filename?: string;
  },
): Promise<Story> {
  const form = new FormData();
  form.append("audio", blob, opts?.filename || "note.webm");
  if (opts?.body) form.append("body", opts.body);
  if (opts?.topic) form.append("topic", opts.topic);
  if (opts?.pseudonym) form.append("pseudonym", opts.pseudonym);
  if (opts?.durationMs != null) {
    form.append("duration_ms", String(Math.round(opts.durationMs)));
  }
  form.append("source_lang", opts?.sourceLang || "ru");
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as Story;
}

/** SSE handler callbacks for aiSupportStream (events: meta → delta* → done). */
export type AiStreamHandlers = {
  onMeta?: (meta: {
    offline: boolean;
    crisis: boolean;
    labeled_ai: boolean;
  }) => void;
  onDelta?: (text: string) => void;
  onDone?: (done: { crisis: boolean; disclaimer: string }) => void;
  onError?: (detail: string) => void;
};

function handleSseFrame(frame: string, handlers: AiStreamHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  } catch {
    return;
  }
  if (event === "meta") {
    handlers.onMeta?.(data as unknown as {
      offline: boolean;
      crisis: boolean;
      labeled_ai: boolean;
    });
  } else if (event === "delta") {
    handlers.onDelta?.(typeof data.text === "string" ? data.text : "");
  } else if (event === "done") {
    handlers.onDone?.(data as unknown as {
      crisis: boolean;
      disclaimer: string;
    });
  } else if (event === "error") {
    handlers.onError?.(
      typeof data.detail === "string" ? data.detail : "stream error",
    );
  }
}

async function aiSupportStreamRequest(
  messages: { role: string; content: string }[],
  surface: string,
  handlers: AiStreamHandlers,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/ai/support/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages, surface }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  if (!res.body) {
    throw new ApiError("Streaming not supported", res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      handleSseFrame(buffer.slice(0, sep), handlers);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
    }
  }
}

export const api = {
  health: () => request<HealthResponse>("/api/v1/health"),

  me: () => request<Me>("/api/v1/me"),

  register: (email: string, password: string, pseudonym = "") =>
    request<Me>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, pseudonym }),
    }),

  login: (email: string, password: string) =>
    request<Me>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),


  /** Telegram Mini App host: raw initData query string (HMAC validated server-side). */
  loginTelegram: (initData: string) =>
    request<Me>("/api/v1/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ init_data: initData }),
    }),

  openInbox: (token: string) =>
    request<InboxOpenResponse>("/api/v1/auth/inbox", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  logout: () =>
    request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),

  topics: () => request<Topic[]>("/api/v1/topics"),

  feed: (cursor?: string | null, topic?: string | null) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (topic) params.set("topic", topic);
    const q = params.toString() ? `?${params}` : "";
    return request<FeedResponse>(`/api/v1/stories${q}`);
  },

  getStory: (id: string) => request<Story>(`/api/v1/stories/${id}`),

  storyThread: (id: string) =>
    request<StoryThread>(`/api/v1/stories/${id}/thread`),

  editStory: (id: string, body: string) =>
    request<Story>(`/api/v1/stories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),

  hideStory: (id: string) =>
    request<Story>(`/api/v1/stories/${id}/hide`, { method: "POST" }),

  unhideStory: (id: string) =>
    request<Story>(`/api/v1/stories/${id}/unhide`, { method: "POST" }),

  deleteStory: (id: string) =>
    request<Story>(`/api/v1/stories/${id}`, { method: "DELETE" }),

  addComment: (postId: string, body: string) =>
    request<Story>(`/api/v1/stories/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  translateUiCatalog: (
    targetLang: string,
    strings: Record<string, string>,
    sourceLang = "en",
  ) =>
    request<{ target_lang: string; strings: Record<string, string> }>(
      "/api/v1/i18n/ui-catalog",
      {
        method: "POST",
        body: JSON.stringify({
          target_lang: targetLang,
          source_lang: sourceLang,
          strings,
        }),
      },
    ),

  publishStory: (body: string, opts?: { pseudonym?: string; topic?: string }) =>
    request<Story>("/api/v1/stories", {
      method: "POST",
      body: JSON.stringify({
        body,
        pseudonym: opts?.pseudonym || null,
        topic: opts?.topic || null,
      }),
    }),

  publishStoryVoice: (
    blob: Blob,
    opts?: {
      body?: string;
      topic?: string;
      pseudonym?: string;
      durationMs?: number;
      sourceLang?: string;
      filename?: string;
    },
  ) =>
    postStoryVoice("/api/v1/stories/voice", blob, opts),

  commentStoryVoice: (
    postId: string,
    blob: Blob,
    opts?: {
      body?: string;
      durationMs?: number;
      sourceLang?: string;
      filename?: string;
    },
  ) =>
    postStoryVoice(`/api/v1/stories/${postId}/comments/voice`, blob, opts),

  myStories: () => request<AuthorStory[]>("/api/v1/me/stories"),

  offerEmpathy: (storyId: string) =>
    request<EmpathyResponse>(`/api/v1/stories/${storyId}/empathy`, {
      method: "POST",
    }),

  setOutreachConsent: (storyId: string, outreachOptIn: boolean) =>
    request<{ ok: boolean; outreach_opt_in: boolean; message: string }>(
      `/api/v1/stories/${storyId}/empathy/outreach-consent`,
      {
        method: "POST",
        body: JSON.stringify({ outreach_opt_in: outreachOptIn }),
      },
    ),

  storyHearers: (storyId: string) =>
    request<Hearer[]>(`/api/v1/stories/${storyId}/hearers`),

  authorOutreach: (
    storyId: string,
    payload: {
      mode: "one" | "many" | "random";
      hearer_refs?: string[];
      intent?: string;
    },
  ) =>
    request<OutreachResponse>(`/api/v1/stories/${storyId}/outreach`, {
      method: "POST",
      body: JSON.stringify({
        mode: payload.mode,
        hearer_refs: payload.hearer_refs ?? [],
        intent: payload.intent ?? "listen",
      }),
    }),

  getPulse: (storyId: string) =>
    request<PulseResponse>(`/api/v1/stories/${storyId}/pulse`),

  reportStory: (storyId: string, reason: string, details = "") =>
    request<ReportResponse>(`/api/v1/stories/${storyId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, details }),
    }),

  reportMessage: (messageId: string, reason: string, details = "") =>
    request<ReportResponse>(`/api/v1/messages/${messageId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, details }),
    }),

  blockPeerInDialogue: (dialogueId: string) =>
    request<{ ok: boolean; created: boolean; message: string }>(
      `/api/v1/dialogues/${dialogueId}/block-peer`,
      { method: "POST" },
    ),

  unblockPeerInDialogue: (dialogueId: string) =>
    request<{ ok: boolean; created: boolean; message: string }>(
      `/api/v1/dialogues/${dialogueId}/unblock-peer`,
      { method: "POST" },
    ),

  reportBug: (text: string, page: string) =>
    request<BugReportOut>("/api/v1/bugs", {
      method: "POST",
      body: JSON.stringify({ text, page }),
    }),

  myBlocks: () => request<BlockItem[]>("/api/v1/blocks"),

  unblockById: (blockId: string) =>
    request<{ ok: boolean; created: boolean; message: string }>(
      `/api/v1/blocks/${blockId}`,
      { method: "DELETE" },
    ),

  dialogueIntents: () => request<IntentOption[]>("/api/v1/dialogue/intents"),

  requestDialogue: (storyId: string, intent: string, note = "") =>
    request<DialogueRequest>(`/api/v1/stories/${storyId}/dialogue-requests`, {
      method: "POST",
      body: JSON.stringify({ intent, note }),
    }),

  dialogueInbox: () =>
    request<DialogueRequest[]>("/api/v1/me/dialogue-requests"),

  acceptDialogueRequest: (requestId: string) =>
    request<Dialogue>(`/api/v1/dialogue-requests/${requestId}/accept`, {
      method: "POST",
    }),

  declineDialogueRequest: (requestId: string) =>
    request<DialogueRequest>(`/api/v1/dialogue-requests/${requestId}/decline`, {
      method: "POST",
    }),

  createHelpRequest: (note = "") =>
    request<HelpRequest>("/api/v1/help/requests", {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  myHelpRequest: () => request<HelpRequest>("/api/v1/help/requests/mine"),

  helpInbox: () => request<HelpRequest[]>("/api/v1/help/requests"),

  acceptHelpRequest: (id: string) =>
    request<Dialogue>(`/api/v1/help/requests/${id}/accept`, { method: "POST" }),

  skipHelpRequest: (id: string) =>
    request<HelpRequest>(`/api/v1/help/requests/${id}/skip`, { method: "POST" }),

  cancelHelpRequest: (id: string) =>
    request<HelpRequest>(`/api/v1/help/requests/${id}/cancel`, {
      method: "POST",
    }),

  helpPresence: () => request<HelpPresence>("/api/v1/help/presence"),

  helperHeartbeat: () =>
    request<{ ok: boolean }>("/api/v1/help/heartbeat", { method: "POST" }),

  helperDashboard: () => request<HelperDashboard>("/api/v1/help/dashboard"),

  createHelperInvite: (org = "", ttlHours = 168) =>
    request<HelperInvite>("/api/v1/helper-invites", {
      method: "POST",
      body: JSON.stringify({ org, ttl_hours: ttlHours }),
    }),

  listHelperInvites: () => request<HelperInvite[]>("/api/v1/helper-invites"),

  getHelperInvite: (token: string) =>
    request<HelperInvite>(`/api/v1/helper-invites/${token}`),

  revokeHelperInvite: (token: string) =>
    request<{ ok: boolean }>(`/api/v1/helper-invites/${token}`, {
      method: "DELETE",
    }),

  acceptHelperInvite: (token: string, pledge: boolean) =>
    request<{ ok: boolean; is_helper: boolean; helper_org: string; message: string }>(
      `/api/v1/helper-invites/${token}/accept`,
      {
        method: "POST",
        body: JSON.stringify({ pledge }),
      },
    ),

  setHelperDuty: (on: boolean) =>
    request<Me>("/api/v1/me/helper-duty", {
      method: "POST",
      body: JSON.stringify({ on }),
    }),

  fundInfo: () => request<FundInfo>("/api/v1/fund/info"),

  setTipWallet: (payload: { address: string; nonce?: string; signature?: string }) =>
    request<TipWalletResponse>("/api/v1/me/tip-wallet", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  myDialogues: () => request<Dialogue[]>("/api/v1/me/dialogues"),

  getDialogue: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}`),

  dialogueMessages: (dialogueId: string) =>
    request<ChatMessage[]>(`/api/v1/dialogues/${dialogueId}/messages`),

  sendMessage: (
    dialogueId: string,
    body: string,
    sourceLang = "ru",
    replyToId?: string | null,
  ) =>
    request<ChatMessage>(`/api/v1/dialogues/${dialogueId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        body,
        source_lang: sourceLang,
        reply_to_id: replyToId || null,
      }),
    }),

  editMessage: (messageId: string, body: string) =>
    request<ChatMessage>(`/api/v1/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),

  deleteMessage: (messageId: string, scope: "me" | "everyone") =>
    request<ChatMessage>(
      `/api/v1/messages/${messageId}?scope=${scope}`,
      { method: "DELETE" },
    ),

  forwardMessage: (messageId: string, dialogueId: string) =>
    request<ChatMessage>(`/api/v1/messages/${messageId}/forward`, {
      method: "POST",
      body: JSON.stringify({ dialogue_id: dialogueId }),
    }),

  pinMessage: (dialogueId: string, messageId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/pin`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    }),

  unpinMessage: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/unpin`, {
      method: "POST",
    }),

  pinChat: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/pin-chat`, {
      method: "POST",
    }),

  unpinChat: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/unpin-chat`, {
      method: "POST",
    }),

  muteDialogue: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/mute`, {
      method: "POST",
    }),

  unmuteDialogue: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/unmute`, {
      method: "POST",
    }),

  markDialogueRead: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/mark-read`, {
      method: "POST",
    }),

  markDialogueUnread: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/mark-unread`, {
      method: "POST",
    }),

  clearHistory: (dialogueId: string, scope: "me" | "everyone" = "me") =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/clear-history`, {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),

  sendVoiceMessage: async (
    dialogueId: string,
    blob: Blob,
    opts?: { durationMs?: number; sourceLang?: string; filename?: string },
  ) => {
    const form = new FormData();
    const name = opts?.filename || "note.webm";
    form.append("audio", blob, name);
    if (opts?.durationMs != null) {
      form.append("duration_ms", String(Math.round(opts.durationMs)));
    }
    form.append("source_lang", opts?.sourceLang || "ru");

    const res = await fetch(
      `${API_URL}/api/v1/dialogues/${dialogueId}/messages/voice`,
      {
        method: "POST",
        body: form,
        credentials: "include",
      },
    );
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { detail?: string };
        if (data.detail) detail = data.detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as ChatMessage;
  },

  /**
   * Circle (video note) — ephemeral by design.
   * Endpoint contract ready; backend may return 404 until shipped.
   */
  sendCircleMessage: async (
    dialogueId: string,
    blob: Blob,
    opts?: SendCircleOptions,
  ) => {
    const form = new FormData();
    const name = opts?.filename || "circle.webm";
    form.append("video", blob, name);
    if (opts?.durationMs != null) {
      form.append("duration_ms", String(Math.round(opts.durationMs)));
    }
    form.append("source_lang", opts?.sourceLang || "ru");

    const res = await fetch(
      `${API_URL}/api/v1/dialogues/${dialogueId}/messages/circle`,
      {
        method: "POST",
        body: form,
        credentials: "include",
      },
    );
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { detail?: string };
        if (data.detail) detail = data.detail;
      } catch {
        /* ignore */
      }
      if (res.status === 404 || res.status === 501 || res.status === 405) {
        throw new ApiError(
          "Circles API is not enabled on the server yet",
          res.status,
        );
      }
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as ChatMessage;
  },

  /**
   * Voice retention settings (Ephemeral Voice Note).
   * GET/POST planned; until backend exists, throws 404 and callers use local prefs.
   */
  voiceRetentionSettings: () =>
    request<VoiceRetentionSettings>("/api/v1/me/voice-retention"),

  updateVoiceRetentionSettings: (payload: VoiceRetentionSettings) =>
    request<VoiceRetentionSettings>("/api/v1/me/voice-retention", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  translateMessage: (messageId: string, targetLang: string) =>
    request<ChatMessage>(`/api/v1/messages/${messageId}/translate`, {
      method: "POST",
      body: JSON.stringify({ target_lang: targetLang }),
    }),

  closeDialogue: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/close`, {
      method: "POST",
    }),

  reopenDialogue: (dialogueId: string) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}/reopen`, {
      method: "POST",
    }),

  deleteDialogue: (
    dialogueId: string,
    scope: "me" | "everyone" = "me",
  ) =>
    request<Dialogue>(`/api/v1/dialogues/${dialogueId}?scope=${scope}`, {
      method: "DELETE",
    }),

  aiSupport: (
    messages: { role: string; content: string }[],
    surface: "companion" | "anti_panic" = "companion",
  ) =>
    request<AiSupportResponse>("/api/v1/ai/support", {
      method: "POST",
      body: JSON.stringify({ messages, surface }),
    }),

  aiSupportStream: (
    messages: { role: string; content: string }[],
    surface: "companion" | "anti_panic" = "companion",
    handlers: AiStreamHandlers = {},
  ) => aiSupportStreamRequest(messages, surface, handlers),

  quietPhrases: (lang: "ru" | "en" = "ru") =>
    request<QuietPhrase[]>(`/api/v1/quiet-phrases?lang=${lang}`),

  sendQuietPhrase: (storyId: string, phraseKey: string) =>
    request<SendCloudResponse>(`/api/v1/stories/${storyId}/clouds`, {
      method: "POST",
      body: JSON.stringify({ phrase_key: phraseKey }),
    }),

  sendModeratedCloud: (storyId: string, body: string) =>
    request<SendCloudResponse>(`/api/v1/stories/${storyId}/clouds`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  storyClouds: (storyId: string) =>
    request<SupportCloud[]>(`/api/v1/stories/${storyId}/clouds`),

  dismissCloud: (storyId: string, cloudId: string) =>
    request<ModerationActionResponse>(
      `/api/v1/stories/${storyId}/clouds/${cloudId}/dismiss`,
      { method: "POST" },
    ),

  markCloudsRead: (storyId: string) =>
    request<{ ok: boolean; cloud_unread: number }>(
      `/api/v1/stories/${storyId}/clouds/mark-read`,
      { method: "POST" },
    ),

  moderationQueue: () => request<QueueCloud[]>("/api/v1/moderation/clouds"),

  approveCloud: (cloudId: string) =>
    request<ModerationActionResponse>(
      `/api/v1/moderation/clouds/${cloudId}/approve`,
      { method: "POST" },
    ),

  rejectCloud: (cloudId: string) =>
    request<ModerationActionResponse>(
      `/api/v1/moderation/clouds/${cloudId}/reject`,
      { method: "POST" },
    ),

  moderationDashboard: () =>
    request<ModerationDashboard>("/api/v1/moderation/dashboard"),

  notifySettings: () => request<NotifySettings>("/api/v1/me/notify-settings"),

  updateNotifySettings: (payload: NotifySettingsUpdate) =>
    request<NotifySettings>("/api/v1/me/notify-settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  testNotifyDigest: () =>
    request<DigestTestResponse>("/api/v1/me/notify-settings/test", {
      method: "POST",
    }),

  testTelegramDigest: () =>
    request<DigestTestResponse>("/api/v1/me/notify-settings/test-telegram", {
      method: "POST",
    }),

  rtcConfig: () =>
    request<{ ice_servers: RTCIceServer[] }>("/api/v1/rtc/config"),

  therapistProfiles: () =>
    request<TherapistProfileOut[]>("/api/v1/therapy/profiles"),

  therapyClaim: (token: string) =>
    request<TherapistProfileOut>("/api/v1/therapy/claim", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  therapyCreateSession: (therapistId: string, note = "") =>
    request<TherapySession>("/api/v1/therapy/sessions", {
      method: "POST",
      body: JSON.stringify({ therapist_id: therapistId, note }),
    }),

  therapyMySessions: () =>
    request<TherapySession[]>("/api/v1/me/therapy/sessions"),

  therapyInbox: () => request<TherapySession[]>("/api/v1/me/therapy/inbox"),

  therapyIPaid: (id: string) =>
    request<TherapySession>(`/api/v1/therapy/sessions/${id}/i-paid`, {
      method: "POST",
    }),

  therapyConfirm: (id: string) =>
    request<TherapySession>(`/api/v1/therapy/sessions/${id}/confirm`, {
      method: "POST",
    }),

  therapyDecline: (id: string) =>
    request<TherapySession>(`/api/v1/therapy/sessions/${id}/decline`, {
      method: "POST",
    }),

  therapyComplete: (id: string) =>
    request<TherapySession>(`/api/v1/therapy/sessions/${id}/complete`, {
      method: "POST",
    }),

};
