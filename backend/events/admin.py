from django.contrib import admin
from .models import Event, EventConstraintOverride, EventDishComment


class EventConstraintOverrideInline(admin.StackedInline):
    model = EventConstraintOverride
    extra = 0


class EventDishCommentInline(admin.TabularInline):
    model = EventDishComment
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ['name', 'date', 'status', 'customer', 'venue', 'gents', 'ladies', 'event_type', 'service_style']
    list_filter = ['date', 'status', 'event_type', 'service_style']
    search_fields = ['name', 'customer__name', 'customer__company_name', 'venue__name', 'notes']
    filter_horizontal = ['dishes']
    raw_id_fields = ['customer', 'venue']
    inlines = [EventConstraintOverrideInline, EventDishCommentInline]
