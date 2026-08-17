"""A tiny, dependency-free validator for the JSON-schema subset our LLM nodes use.

LLM nodes are prompt -> structured JSON (see ``agents/nodes/llm_node.py``). The
provider is *asked* to honour a JSON schema (``portioning/llm.py`` passes it as
the response format), but "asked" is not "guaranteed": a model can still return
the wrong shape, and our fake test provider returns whatever we script. So the
node validates every response against the same schema and retries on a miss.

We deliberately do **not** pull in the ``jsonschema`` package — the schemas an
agent uses are small, hand-written object schemas, and a focused validator keeps
the dependency surface minimal (matching the repo rule that agents adopt
LangGraph for graphs only, not a wider ecosystem). Supported constructs:

* ``type``: ``object``, ``array``, ``string``, ``integer``, ``number``,
  ``boolean``, ``null`` (or a list of those for a union)
* ``object``: ``properties``, ``required``, ``additionalProperties`` (bool)
* ``array``: ``items`` (a sub-schema)
* ``enum``: membership check

Anything else in a schema is ignored (treated as "no further constraint"), so a
richer schema never *falsely* rejects — it just may not enforce the extra rule.
"""


class SchemaValidationError(ValueError):
    """A parsed LLM response did not match its declared schema."""


# JSON type name -> the Python types that satisfy it. ``bool`` is excluded from
# the numeric types on purpose: in JSON, true/false are not numbers, and Python's
# ``isinstance(True, int)`` would otherwise wave a boolean through an integer field.
_TYPE_CHECKS = {
    'object': lambda v: isinstance(v, dict),
    'array': lambda v: isinstance(v, list),
    'string': lambda v: isinstance(v, str),
    'boolean': lambda v: isinstance(v, bool),
    'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    'null': lambda v: v is None,
}


def validate_structured(data, schema, _path='$'):
    """Raise :class:`SchemaValidationError` if ``data`` violates ``schema``.

    ``_path`` tracks position for readable error messages (e.g. ``$.items[0]``).
    """
    types = schema.get('type')
    if types is not None:
        allowed = [types] if isinstance(types, str) else list(types)
        unknown = [t for t in allowed if t not in _TYPE_CHECKS]
        if unknown:
            raise SchemaValidationError(f"{_path}: schema names unknown type(s) {unknown}")
        if not any(_TYPE_CHECKS[t](data) for t in allowed):
            raise SchemaValidationError(
                f"{_path}: expected type {'/'.join(allowed)}, got {_json_type(data)}"
            )

    if 'enum' in schema and data not in schema['enum']:
        raise SchemaValidationError(f"{_path}: {data!r} is not one of {schema['enum']}")

    if isinstance(data, dict):
        _validate_object(data, schema, _path)
    elif isinstance(data, list) and 'items' in schema:
        for i, item in enumerate(data):
            validate_structured(item, schema['items'], f"{_path}[{i}]")


def _validate_object(data, schema, path):
    properties = schema.get('properties', {})
    for key in schema.get('required', []):
        if key not in data:
            raise SchemaValidationError(f"{path}: missing required property {key!r}")
    if schema.get('additionalProperties') is False:
        extra = [k for k in data if k not in properties]
        if extra:
            raise SchemaValidationError(f"{path}: unexpected propert{'ies' if len(extra) > 1 else 'y'} {extra}")
    for key, value in data.items():
        if key in properties:
            validate_structured(value, properties[key], f"{path}.{key}")


def _json_type(value):
    if isinstance(value, bool):
        return 'boolean'
    if value is None:
        return 'null'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, int):
        return 'integer'
    if isinstance(value, float):
        return 'number'
    if isinstance(value, list):
        return 'array'
    if isinstance(value, dict):
        return 'object'
    return type(value).__name__
