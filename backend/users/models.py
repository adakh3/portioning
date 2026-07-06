from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.exceptions import ValidationError
from django.db import models


class Organisation(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100, unique=True, default='default')
    country = models.CharField(max_length=2, default='US', help_text='ISO 3166-1 alpha-2')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", "owner")
        return self.create_user(email, password, **extra_fields)


class User(AbstractUser):
    ROLE_CHOICES = [
        ("owner", "Owner"),
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("chef", "Chef"),
        ("salesperson", "Salesperson"),
    ]

    username = None
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="salesperson")
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    product_lines = models.ManyToManyField(
        'bookings.ProductLine',
        blank=True,
        related_name='salespeople',
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    objects = UserManager()

    def __str__(self):
        return self.email

    def clean(self):
        super().clean()
        # Invariant: a user assigned to an organisation is a *tenant* user and must
        # have NO admin access — neither staff (Django-admin login) nor superuser
        # (cross-tenant god mode). Admin/system accounts must have no organisation.
        # This is what stops an org user from ever reaching the Django panel.
        if self.organisation_id and (self.is_staff or self.is_superuser):
            raise ValidationError({
                'organisation': (
                    'A user assigned to an organisation is a tenant user and cannot have '
                    'admin access. Either clear the organisation (to make it a system/admin '
                    'account), or uncheck Staff status and Superuser status.'
                ),
            })
