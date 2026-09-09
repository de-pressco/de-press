"""One dialogue request per sender per story.

Requests used to be limited only while pending; after accept/decline the same
sender could request again, and accepting such a repeat just re-opened the
first dialogue. The unique constraints are widened to every status; legacy
duplicate rows created before the rule are pruned first (the earliest request
in a thread wins; Dialogue.request is SET_NULL, so linked dialogues survive).
"""

from django.conf import settings
from django.db import migrations, models
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
        for story_id, sender_id in groups:
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
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(prune_duplicate_requests, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name='dialoguerequest',
            name='unique_pending_request_account',
        ),
        migrations.RemoveConstraint(
            model_name='dialoguerequest',
            name='unique_pending_request_session',
        ),
        migrations.AddConstraint(
            model_name='dialoguerequest',
            constraint=models.UniqueConstraint(condition=models.Q(('from_account__isnull', False)), fields=('story', 'from_account'), name='unique_request_per_story_account'),
        ),
        migrations.AddConstraint(
            model_name='dialoguerequest',
            constraint=models.UniqueConstraint(condition=models.Q(('from_session__isnull', False)), fields=('story', 'from_session'), name='unique_request_per_story_session'),
        ),
    ]
