/** API response types — ported from legacy Next for app v2. */

export interface Me {
  kind: "account" | "anonymous";
  email: string | null;
  account_id: string | null;
  session_id: string | null;
  pseudonym: string;
  is_authenticated: boolean;
  is_helper?: boolean;
  is_staff?: boolean;
  is_on_duty?: boolean;
  helper_org?: string;
  helper_badge?: string;
  tip_wallet_address?: string;
  tip_wallet_verified?: boolean;
  is_therapist?: boolean;
}

export interface TherapistProfileOut {
  id: string;
  pseudonym: string;
  approach: string;
  languages: string;
  rate_sol: number;
  solana_address: string;
}

export type TherapySessionStatus =
  | "awaiting_payment"
  | "payment_claimed"
  | "paid"
  | "declined"
  | "done";

export interface TherapySession {
  id: string;
  therapist_id: string;
  therapist_label: string;
  client_label: string;
  status: TherapySessionStatus;
  price_sol: number;
  note: string;
  solana_address: string;
  dialogue_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FundInfo {
  treasury_address: string;
  squads_url: string;
}

export interface TipWalletResponse {
  ok: boolean;
  tip_wallet_address: string;
  tip_wallet_verified?: boolean;
}

export interface HelpPresence {
  someone_on_duty: boolean;
  someone_online: boolean;
}

export interface HelperInvite {
  token: string;
  org: string;
  expires_at: string;
  used: boolean;
}

export interface ReceivedCloud {
  id: string;
  phrase_key: string;
  body: string;
}

export interface Story {
  id: string;
  body: string;
  topic: string;
  pseudonym: string;
  published_at: string | null;
  status: string;
  is_mine?: boolean;
  author_key?: string;
  parent_id?: string | null;
  my_phrase_key?: string;
  cloud_unread?: number;
  cloud_gesture?: string;
  received_clouds?: ReceivedCloud[];
  audio_url?: string | null;
  duration_ms?: number | null;
}

export interface AuthorStory extends Story {
  pulse_count: number;
  pulse_message: string;
}

export interface Topic {
  value: string;
  label: string;
}

export interface FeedResponse {
  items: Story[];
  next_cursor: string | null;
}

export interface StoryThread {
  items: Story[];
}

export interface EmpathyResponse {
  ok: boolean;
  created: boolean;
  message: string;
  outreach_opt_in?: boolean;
}

export interface Hearer {
  hearer_ref: string;
  pseudonym: string;
  outreach_opt_in: boolean;
  created_at: string;
  has_open_dialogue: boolean;
}

export interface OutreachResponse {
  ok: boolean;
  created_count: number;
  reused_count: number;
  dialogues: Dialogue[];
  message: string;
}

export interface PulseResponse {
  story_id: string;
  count: number;
  message: string;
}

export interface HealthResponse {
  status: string;
  database: boolean;
  redis: boolean;
  channels?: boolean;
}

export interface ReportResponse {
  ok: boolean;
  created: boolean;
  report_id: string;
  message: string;
}

export interface DialogueRequest {
  id: string;
  story_id: string;
  intent: string;
  note: string;
  status: string;
  created_at: string;
}

export interface Dialogue {
  id: string;
  story_id: string | null;
  intent: string;
  status: string;
  source?: string;
  rules: string;
  updated_at: string;
  peer_label?: string;
  last_preview?: string;
  closed_by_me?: boolean;
  can_reopen?: boolean;
  peer_hidden?: boolean;
  hidden_for_me?: boolean;
  pinned_message_id?: string | null;
  pinned?: boolean;
  muted?: boolean;
  unread_count?: number;
  peer_tip_wallet?: string;
  peer_tip_wallet_verified?: boolean;
}

export interface HelpRequest {
  id: string;
  note: string;
  status: "pending" | "accepted" | "cancelled" | string;
  dialogue_id: string | null;
  created_at: string;
}

/** Q8 ops metrics for the Helper dashboard (no per-Helper seconds/ratings). */
export interface HelperDashboard {
  queue_length: number;
  median_wait_seconds_7d: number | null;
  taken_24h: number;
  closed_24h: number;
  taken_7d: number;
  closed_7d: number;
  on_duty: number;
  online: number;
}

/** Message kinds in Initiated Dialogue. `circle` = short ephemeral video. */
export type ChatMessageKind = "text" | "voice" | "circle" | string;

export interface ChatMessage {
  id: string;
  kind?: ChatMessageKind;
  body: string;
  display_text?: string;
  source_lang?: string;
  translations?: Record<string, string>;
  duration_ms?: number | null;
  audio_url?: string | null;
  /** Circle / future video media (same-origin path or absolute URL). */
  video_url?: string | null;
  /** Ephemeral: deleted when dialogue closes (Circles always true when set). */
  ephemeral?: boolean;
  created_at: string;
  from_me: boolean;
  is_system: boolean;
  from_account_id?: string | null;
  from_session_id?: string | null;
  deleted?: boolean;
  edited_at?: string | null;
  forwarded?: boolean;
  forwarded_preview?: string;
  reply_to?: { id: string; preview: string; from_me: boolean } | null;
  pinned?: boolean;
}

/**
 * Voice note lifetime preference (Ephemeral Voice Note).
 * Server will honor later; client stores preference now.
 */
export type VoiceRetention = "delete_on_close" | "keep";

export interface VoiceRetentionSettings {
  voice_retention: VoiceRetention;
}

/**
 * Planned circle upload contract (backend not shipped yet):
 * POST /api/v1/dialogues/{id}/messages/circle
 * multipart: video (file), duration_ms?, source_lang?
 * → ChatMessage with kind=circle, video_url, ephemeral=true
 */
export interface SendCircleOptions {
  durationMs?: number;
  sourceLang?: string;
  filename?: string;
}

export interface IntentOption {
  value: string;
  label: string;
}

export interface QuietPhrase {
  key: string;
  text: string;
  image_url?: string | null;
}

export interface SendCloudResponse {
  ok: boolean;
  created: boolean;
  message: string;
  cloud_id: string | null;
  status?: string | null;
}

export interface SupportCloud {
  id: string;
  body: string;
  kind: string;
  status: string;
  pseudonym: string;
  sender_ref: string;
  helper_badge?: string;
  is_priority?: boolean;
  created_at: string;
  image_url?: string | null;
  phrase_key?: string;
}

export interface QueueCloud extends SupportCloud {
  story_id: string;
  story_preview: string;
}

export interface ModerationActionResponse {
  ok: boolean;
  status: string;
  message: string;
  cloud_id: string;
}

export type NotificationKind =
  | "dialogue_request"
  | "support_cloud"
  | "cloud_approved"
  | "dialogue_opened"
  | "outreach_intro"
  | "message"
  | "dialogue_deleted"
  | "silent_empathy"
  | "help_requested"
  | "help_accepted"
  | "dialogue_request_review"
  | "report_resolved"
  | "report_new";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  payload: Record<string, string>;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCountResponse {
  count: number;
}

export interface MarkNotificationReadResponse {
  ok: boolean;
  id: string;
  is_read: boolean;
}

export interface MarkAllNotificationsReadResponse {
  ok: boolean;
  updated: number;
}

export interface InboxOpenResponse {
  ok: boolean;
  kind: "account" | "anonymous";
  opened: number;
}

export interface NotifySettings {
  ok: boolean;
  email: string;
  notify_email_opt_in: boolean;
  notify_digest_frequency: "off" | "immediate" | "daily";
  email_verified: boolean;
  has_telegram?: boolean;
  notify_telegram_opt_in?: boolean;
  /** Stored per-kind opt-outs (kind -> bool); a missing kind means enabled. */
  notify_kinds?: Record<string, boolean>;
}

export interface NotifySettingsUpdate {
  notify_email_opt_in?: boolean;
  notify_digest_frequency?: "off" | "immediate" | "daily";
  contact_email?: string;
  notify_telegram_opt_in?: boolean;
  /** Partial per-kind update; backend merges it into the stored dict. */
  notify_kinds?: Record<string, boolean>;
}

export interface DigestTestResponse {
  ok: boolean;
  sent_to: string;
  message: string;
}

export interface ModerationDashboard {
  pending_clouds: number;
  open_reports: number;
  reviewing_reports: number;
  reports_last_7d: number;
  recent_reports: {
    id: string;
    reason: string;
    status: string;
    story_preview: string;
    details: string;
    created_at: string;
  }[];
}

export interface AiSupportResponse {
  reply: string;
  crisis: boolean;
  offline: boolean;
  labeled_ai: boolean;
  disclaimer: string;
}

export interface BlockItem {
  id: string;
  created_at: string;
  label: string;
  target_kind: "account" | "session";
}

export interface BugReportOut {
  ok: boolean;
  id: string;
}
