"""One dialogue request per sender per story — prune legacy duplicates.

Requests used to be limited only while pending; after accept/decline the same
sender could request again, and accepting such a repeat just re-opened the
first dialogue. Legacy duplicate rows created before the rule are pruned here
(the earliest request in a thread wins; Dialogue.request is SET_NULL, so
linked dialogues survive). The widened unique constraints land in 0016 —
a separate migration, because PostgreSQL cannot ADD CONSTRAINT in the same
transaction as the prune DML (pending trigger events).
"""

from django.db import migrations
from django.db.models import Count


def prune_duplicate_requests(apps, schema_editor):
    """Keep the earliest request per (story, sender) so the widened unique
    constraints validate on rows created before the rule existed."""
    DialogueRequest = apps.get_model("dialogue", "DialogueRequest")
    for sender_field in ("from_account_id", "from_session_id"):
        groups = (
            DialogueRequest.objects.filter(**{f"{sender_field}__isnull": False})
            .order_by()  # clear Meta.ordering — it would leak into GROUP BY
            .values_list("story_id", sender_field)
            .annotate(total=Count("id"))
            .filter(total__gt=1)
        )
        # values_list(...).annotate(...) appends the annotation: rows are
        # (story_id, sender_id, total) — unpack all three.
        for story_id, sender_id, _total in groups:
            rows = DialogueRequest.objects.filter(
                story_id=story_id, **{sender_field: sender_id}
            ).order_by("created_at", "id")
            for extra in rows[1:]:
                extra.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('dialogue', '0014_alter_dialogue_intent_alter_dialoguerequest_intent'),
        ('identity', '0013_account_telegram_language_code'),
        ('stories', '0006_alter_story_topic'),
    ]

    operations = [
        migrations.RunPython(prune_duplicate_requests, migrations.RunPython.noop),
    ]

