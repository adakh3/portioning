"""Admin behaviour shared by the two booking admins (Quote and Event)."""


class BookingMoneyAdminMixin:
    """Stored money is engine OUTPUT: readable in admin, never typeable.

    `Quote.save()`/`Event.save()` are not overridden and there are no signals, so an
    admin edit never recomputed. That left two ways to end up with stored totals the
    engine disagrees with (REL-462 Bug 3):

    * typing straight into `subtotal`/`total`/`service_charge`/`gratuity`/`tax_amount`
      — `EventAdmin` declared no `readonly_fields` at all, so all five were editable
      and whatever was typed simply stayed there;
    * editing a real INPUT (price/head, tax rate, guest count) and getting no
      recompute, so the stored outputs silently described the old inputs.

    The mixin closes both: the outputs become read-only, and saving re-derives them
    through the same `recalculate_totals()` every other write path uses.
    """

    money_readonly_fields = (
        'subtotal', 'service_charge', 'tax_amount', 'gratuity', 'total',
    )

    def get_readonly_fields(self, request, obj=None):
        # Deduplicated, order preserved: an admin that already listed some of these
        # would otherwise render the field twice on the change form.
        declared = tuple(super().get_readonly_fields(request, obj))
        return declared + tuple(
            f for f in self.money_readonly_fields if f not in declared
        )

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        obj.recalculate_totals()

    def save_related(self, request, form, formsets, change):
        # Again after the inlines: add-on line items land in `save_related`, and the
        # subtotal has to include the ones just added or removed. `recalculate_totals`
        # is idempotent, so running it in both hooks costs a recompute and guarantees
        # the stored numbers match the form that was actually submitted.
        super().save_related(request, form, formsets, change)
        form.instance.recalculate_totals()
