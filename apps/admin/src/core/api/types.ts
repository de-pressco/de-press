export interface AdminOverview {
  sessions_24h: number;
  sessions_7d: number;
  sessions_total: number;
  stories_total: number;
  stories_7d: number;
  hears_total: number;
  dialogues_open: number;
  dialogues_closed: number;
  therapy_by_status: Record<string, number>;
  pending_clouds: number;
  reports_open: number;
  reports_reviewing: number;
  reports_7d: number;
  reports_by_reason: Record<string, number>;
  help_queue: number;
  helpers_on_duty: number;
}

export interface AdminReport {
  id: string;
  status: string;
  reason: string;
  details: string;
  target_kind: "story" | "message";
  target_text: string;
  target_hidden: boolean;
  created_at: string;
  resolved_note: string;
  /** Ticket trail: empty while the report is still open. */
  decision: string;
  resolved_by: string;
  resolution_reason: string;
  resolved_at: string;
}

export interface ResolveBody {
  decision: "hide" | "remove" | "dismiss";
  reason: string;
  note: string;
}

export interface ResolveResponse {
  ok: boolean;
  report: AdminReport;
}

export interface ModerationActionLog {
  id: string;
  action: string;
  reason: string;
  note: string;
  actor_email: string;
  report_id: string | null;
  story_id: string | null;
  message_id: string | null;
  cloud_id: string | null;
  created_at: string;
}

export interface QueueCloud {
  id: string;
  body: string;
  kind: string;
  status: string;
  pseudonym: string;
  helper_badge: string;
  is_priority: boolean;
  created_at: string;
  story_id: string;
  story_preview: string;
}

export interface ModerationResult {
  ok: boolean;
  status: string;
  message: string;
  cloud_id: string;
}

export interface AdminMe {
  pseudonym?: string;
  is_staff?: boolean;
  is_helper?: boolean;
  is_on_duty?: boolean;
}

export interface AdminHelper {
  id: string;
  email: string;
  helper_org: string;
  is_on_duty: boolean;
  is_active: boolean;
  last_seen_at: string | null;
}
