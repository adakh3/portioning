from django.core.management.base import BaseCommand

from users.models import Organisation, User


class Command(BaseCommand):
    help = "Create default organisation and admin user"

    def handle(self, *args, **options):
        org, created = Organisation.objects.get_or_create(
            name="Default",
        )
        if created:
            self.stdout.write(self.style.SUCCESS("Created default organisation"))
        else:
            self.stdout.write("Default organisation already exists")

        if not User.objects.filter(email="admin@example.com").exists():
            User.objects.create_superuser(
                email="admin@example.com",
                password="admin",
                first_name="Admin",
                last_name="User",
                role="owner",
                organisation=org,
            )
            self.stdout.write(self.style.SUCCESS("Created admin user (admin@example.com / admin)"))
        else:
            self.stdout.write("Admin user already exists")
