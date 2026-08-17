"""Unit tests for the dependency-free structured-output validator."""
from django.test import SimpleTestCase

from agents.schema import SchemaValidationError, validate_structured

OBJ = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "count": {"type": "integer"},
    },
    "required": ["question"],
    "additionalProperties": False,
}


class ValidateStructuredTests(SimpleTestCase):
    def test_accepts_valid_object(self):
        validate_structured({"question": "How many?", "count": 3}, OBJ)  # no raise

    def test_optional_property_may_be_omitted(self):
        validate_structured({"question": "How many?"}, OBJ)  # no raise

    def test_missing_required_property_rejected(self):
        with self.assertRaises(SchemaValidationError):
            validate_structured({"count": 3}, OBJ)

    def test_wrong_type_rejected(self):
        with self.assertRaises(SchemaValidationError):
            validate_structured({"question": 42}, OBJ)

    def test_additional_property_rejected_when_disallowed(self):
        with self.assertRaises(SchemaValidationError):
            validate_structured({"question": "hi", "extra": 1}, OBJ)

    def test_boolean_is_not_an_integer(self):
        # JSON booleans must not satisfy an integer field (Python quirk guard).
        with self.assertRaises(SchemaValidationError):
            validate_structured({"question": "hi", "count": True}, OBJ)

    def test_top_level_type_mismatch_rejected(self):
        with self.assertRaises(SchemaValidationError):
            validate_structured(["not", "an", "object"], OBJ)

    def test_enum_membership(self):
        schema = {"type": "string", "enum": ["a", "b"]}
        validate_structured("a", schema)  # no raise
        with self.assertRaises(SchemaValidationError):
            validate_structured("c", schema)

    def test_array_items_validated(self):
        schema = {"type": "array", "items": {"type": "integer"}}
        validate_structured([1, 2, 3], schema)  # no raise
        with self.assertRaises(SchemaValidationError):
            validate_structured([1, "two"], schema)

    def test_number_accepts_int_and_float(self):
        schema = {"type": "object", "properties": {"x": {"type": "number"}}, "required": ["x"]}
        validate_structured({"x": 1}, schema)
        validate_structured({"x": 1.5}, schema)

    def test_union_type(self):
        schema = {"type": ["string", "null"]}
        validate_structured("hi", schema)
        validate_structured(None, schema)
        with self.assertRaises(SchemaValidationError):
            validate_structured(5, schema)
