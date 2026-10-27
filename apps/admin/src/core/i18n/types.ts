export type Lang = "en" | "ru";

/** Каноническая форма локали; en/ru аннотированы этим типом (см. messages/). */
export interface Messages {
  common: {
    loading: string;
    error: string;
    retry: string;
    cancel: string;
    loadMore: string;
  };
  app: {
    title: string;
    tabOverview: string;
    tabReports: string;
    tabClouds: string;
    tabHelpers: string;
    tabLog: string;
    loginCta: string;
    accessDenied: string;
    accessDeniedHint: string;
    openMainApp: string;
  };
  overview: {
    visitors24: string;
    visitors7: string;
    visitorsTotal: string;
    visitorsNote: string;
    storiesTotal: string;
    stories7: string;
    hears: string;
    dialoguesOpen: string;
    dialoguesClosed: string;
    therapy: string;
    pendingClouds: string;
    reportsOpen: string;
    reportsReviewing: string;
    reports7: string;
    reportsByReason: string;
    helpQueue: string;
    helpersOnDuty: string;
  };
  reasons: {
    abuse: string;
    spam: string;
    self_harm: string;
    other: string;
  };
  statuses: {
    open: string;
    reviewing: string;
    resolved_hidden: string;
    resolved_dismissed: string;
  };
  actions: {
    reviewing: string;
    hidden: string;
    removed: string;
    dismissed: string;
    cloud_approved: string;
    cloud_rejected: string;
  };
  reports: {
    queue: string;
    queueTab: string;
    history: string;
    closedBy: string;
    closedAt: string;
    resolutionReason: string;
    filterAll: string;
    empty: string;
    targetStory: string;
    targetMessage: string;
    alreadyHidden: string;
    details: string;
    resolve: string;
    resolving: string;
    decision: string;
    decisionHide: string;
    decisionRemove: string;
    decisionDismiss: string;
    reason: string;
    reasonPlaceholder: string;
    note: string;
    resolvedNote: string;
    reasonRequired: string;
    saved: string;
  };
  clouds: {
    title: string;
    lead: string;
    empty: string;
    approve: string;
    reject: string;
    from: string;
    toStory: string;
    saved: string;
    search: string;
    priorityOnly: string;
    noMatch: string;
  };
  helpers: {
    title: string;
    lead: string;
    empty: string;
    org: string;
    onDuty: string;
    offDuty: string;
    lastSeen: string;
    never: string;
    dutyOn: string;
    dutyOff: string;
    saved: string;
  };
  log: {
    empty: string;
    actor: string;
    when: string;
    action: string;
    reason: string;
    note: string;
  };
}
