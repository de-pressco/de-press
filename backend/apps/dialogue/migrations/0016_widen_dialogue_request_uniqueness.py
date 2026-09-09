"""Widen dialogue request uniqueness to every status.

Split from 0015: PostgreSQL cannot ADD CONSTRAINT in the same transaction as
the prune DML (pending trigger events), so the constraint swap lands here,
after the prune transaction has committed.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dialogue', '0015_one_request_per_user_per_story'),
    ]

    operations = [
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
