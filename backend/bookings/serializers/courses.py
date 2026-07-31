"""Shared serialization for a booking's courses (BookingCourse) + the dish→course
assignment, used by BOTH the Quote and Event serializers (REL-417). Courses group
the menu (Starter/Entrée/Dessert) each with a service style; the frontend addresses
a dish's course by its INDEX in the ordered courses list, so ids never leak."""
from rest_framework import serializers

from events.models import BookingCourse


class BookingCourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingCourse
        fields = ['name', 'sort_order']


def read_courses(booking):
    """The booking's courses in order, as plain dicts."""
    return BookingCourseSerializer(booking.courses.all(), many=True).data


def read_dish_courses(booking):
    """``{dish_id: course_index}`` — the index into ``read_courses(booking)`` for each
    dish that is assigned to a course (mirrors the write payload's index addressing)."""
    index_by_id = {c.id: i for i, c in enumerate(booking.courses.all())}
    out = {}
    for r in booking.dish_comments.all():
        if r.course_id in index_by_id:
            out[str(r.dish_id)] = index_by_id[r.course_id]
    return out
