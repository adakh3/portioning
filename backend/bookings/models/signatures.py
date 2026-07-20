from decimal import Decimal

from django.db import models


class BookingSignature(models.Model):
    """An immutable e-signature: a client's agreement to a booking (a quote OR
    an event) at a single point in time.

    Deliberately append-only. A booking may accumulate several signatures over
    its life (initial acceptance, later amendments), but a row is never edited —
    it freezes exactly what was agreed (the total, guest count and a rendered PDF
    snapshot) plus who agreed and from where. The live booking keeps changing
    afterwards; this record does not follow it.

    Attaches to a quote XOR an event, mirroring BookingLineItem / BookingMeal.
    Org is derived through the parent (no direct organisation column).
    """
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='signatures',
    )
    event = models.ForeignKey(
        'events.Event', null=True, blank=True,
        on_delete=models.CASCADE, related_name='signatures',
    )

    # Who signed
    signer_name = models.CharField(max_length=200)
    signer_email = models.EmailField(blank=True)
    # Optional hand-drawn signature captured on a canvas, stored as a PNG data URL.
    # The typed name + consent is the legal anchor; this is presentation only.
    signature_image = models.TextField(blank=True)
    # The exact agreement/consent statement shown to the client at signing time.
    consent_text = models.TextField(blank=True)

    # Immutable snapshot of what was agreed
    agreed_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    agreed_guest_count = models.IntegerField(null=True, blank=True)
    currency_code = models.CharField(max_length=10, blank=True)
    # Frozen PDF of exactly what was signed, so a later edit to the booking can
    # never rewrite the signed document.
    signed_pdf = models.BinaryField(null=True, blank=True)

    # Tamper-evidence / attribution metadata (ESIGN Act / UAE e-transactions law)
    signed_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    class Meta:
        ordering = ['-signed_at']
        constraints = [
            models.CheckConstraint(
                name='bookingsignature_exactly_one_parent',
                condition=(
                    models.Q(quote__isnull=False, event__isnull=True)
                    | models.Q(quote__isnull=True, event__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"Signed by {self.signer_name} on {self.signed_at:%Y-%m-%d}"

    @property
    def booking(self):
        return self.quote or self.event
