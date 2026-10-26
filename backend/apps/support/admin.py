from django.contrib import admin, messages

from apps.identity.services import Actor
from apps.support.models import QuietPhrase, SupportCloud, SupportCloudStatus
from apps.support.services import SupportError, approve_cloud, reject_cloud


@admin.register(QuietPhrase)
class QuietPhraseAdmin(admin.ModelAdmin):
    list_display = ("key", "text_ru", "text_en", "sort_order", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("key", "text_ru", "text_en")
    ordering = ("sort_order", "key")


def _moderator_actor(request) -> Actor:
    user = request.user
    account = user if getattr(user, "is_authenticated", False) else None
    return Actor(kind="account", account=account)


@admin.action(description="Approve selected Moderated Clouds")
def approve_clouds(modeladmin, request, queryset):
    actor = _moderator_actor(request)
    done = failed = 0
    for cloud in queryset.filter(status=SupportCloudStatus.PENDING):
        try:
            approve_cloud(actor, cloud.id)
        except SupportError:
            failed += 1
        else:
            done += 1
    modeladmin.message_user(
        request, f"Approved {done} cloud(s), skipped {failed}.", messages.SUCCESS
    )


@admin.action(description="Reject selected Moderated Clouds")
def reject_clouds(modeladmin, request, queryset):
    actor = _moderator_actor(request)
    done = failed = 0
    for cloud in queryset.filter(status=SupportCloudStatus.PENDING):
        try:
            reject_cloud(actor, cloud.id)
        except SupportError:
            failed += 1
        else:
            done += 1
    modeladmin.message_user(
        request, f"Rejected {done} cloud(s), skipped {failed}.", messages.WARNING
    )


@admin.register(SupportCloud)
class SupportCloudAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "story",
        "kind",
        "status",
        "is_priority",
        "helper_badge",
        "pseudonym_snapshot",
        "body_snapshot",
        "created_at",
        "moderated_at",
    )
    list_filter = ("kind", "status", "is_priority")
    search_fields = ("body_snapshot", "pseudonym_snapshot", "helper_badge")
    actions = (approve_clouds, reject_clouds)
    readonly_fields = (
        "id",
        "story",
        "from_account",
        "from_session",
        "kind",
        "phrase",
        "body_snapshot",
        "pseudonym_snapshot",
        "helper_badge",
        "is_priority",
        "created_at",
        "moderated_at",
        "moderated_by",
    )
    raw_id_fields = (
        "story",
        "from_account",
        "from_session",
        "phrase",
        "moderated_by",
    )

    def has_add_permission(self, request):
        return False
