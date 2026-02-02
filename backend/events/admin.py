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
    list_display = ['name', 'date', 'gents', 'ladies', 'big_eaters', 'big_eaters_percentage', 'based_on_template']
    list_filter = ['date']
    search_fields = ['name']
    filter_horizontal = ['dishes']
    inlines = [EventConstraintOverrideInline, EventDishCommentInline]
