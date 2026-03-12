---
name: validation-audit
description: Audit the codebase for missing field validation, unguarded computed fields, and missing frontend input constraints
user_invocable: true
---

# Validation & Error Handling Audit

Perform a comprehensive audit of the portioning codebase for validation and error handling gaps. Report findings grouped by severity.

## What to Check

### 1. Backend Model Validators
Scan all files matching `backend/*/models.py` and `backend/*/models/*.py`:
- **IntegerField / PositiveIntegerField**: Must have both `MinValueValidator` and `MaxValueValidator`
- **DecimalField**: Must have `MinValueValidator(0)` (for prices/quantities) and `MaxValueValidator` with a reasonable business limit
- **FloatField**: Should have `MinValueValidator(0)` where negative values are not meaningful

### 2. Serializer TextField Length Limits
Scan all files matching `backend/*/serializers*.py` and `backend/*/serializers/*.py`:
- **TextField fields** exposed in serializers must have `max_length` set via `extra_kwargs`
- Standard limits: notes=5000, descriptions=2000, addresses=1000, comments=2000, quotation_terms=10000
- Check that `extra_kwargs` dict exists in the serializer's Meta class and includes all writable TextFields

### 3. Serializer Computed Fields
Scan all files matching `backend/*/serializers*.py`:
- **SerializerMethodField** / `get_*` methods: Must have `try/except` wrapping any arithmetic or DB access, returning `None` on failure
- **DecimalField(read_only=True)** that maps to a model `@property`: These are dangerous because a property that returns a value exceeding `max_digits` will crash the entire list endpoint. Convert to `SerializerMethodField` with try/except.
- **Division operations**: Must guard against division by zero

### 4. View Error Handling
Scan all files matching `backend/*/views*.py`:
- **`calculate_portions()` calls**: Must be wrapped in try/except
- **Division operations**: Must have zero-guards
- **Transition methods** (e.g., `transition_to()`): Should catch more than just `ValueError`

### 5. Frontend Input Constraints
Scan all files matching `frontend/app/**/page.tsx`:
- **`type="number"` inputs**: Must have both `min` and `max` attributes
- **`min` attribute format**: Should use JSX number syntax `min={0}` not string `min="0"`
- **Price fields**: Should have `max={9999999.99}` or similar reasonable cap
- **Guest count fields**: Should have `max={50000}` or `max={100000}`
- **Rate fields** (hourly rate, etc.): Should have `min={0}` and `max` set

### 6. Global Error Handling
- Check `backend/portioning/settings.py` has `'EXCEPTION_HANDLER'` in `REST_FRAMEWORK`
- Check that the exception handler exists and returns structured JSON for unhandled errors

## Output Format

Group findings by severity:
- **CRITICAL**: Can cause 500 errors on list/detail endpoints (computed field overflow, missing exception handler)
- **HIGH**: Missing validators that allow unreasonable values leading to downstream issues
- **MEDIUM**: Missing frontend constraints, minor validation gaps
- **LOW**: Style issues (string vs number min attributes)

For each finding, report:
- File path and line number
- Field/input name
- What's missing
- Suggested fix
