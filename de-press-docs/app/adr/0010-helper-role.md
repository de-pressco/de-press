# Helper role for trusted listeners

A **Helper** is a verified volunteer or partner-organization listener (not automatically a clinician). Helpers can send Support Clouds (with optional priority) and moderate the Moderated Cloud queue. Authors may see a private badge (“Helper · org”) on clouds, never a public ranking. Crisis lines remain external (112 / 103 / partner links); Helpers do not replace emergency services. This lets founders and NGOs staff empathy without opening unmoderated public replies.

Help Request is in-app volunteer chat, not 112; Helper accept is the documented exception to “only Story author opens Dialogue” because there is no Story and the requester asked.

**Amendment 2026-10-27.** The moderator IS a Helper: staff access implies the helper role
(`is_staff ⇒ is_helper`, enforced in `Account.save()`), so there is no separate moderator role.
Duty gates notifications and instant match only — the shared help-request pool (and the `/chat`
grey rows) is visible to every Helper, on duty or not.
