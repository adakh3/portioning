"use client";

import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+\d][\d\s\-().]*$/;
const NUMERIC_REGEX = /^-?\d*\.?\d*$/;

function validate(
  value: string,
  type: string | undefined,
  min: number | undefined,
  max: number | undefined,
  maxLength: number | undefined
): string | undefined {
  if (!value) return undefined;

  if (type === "email") {
    if (!EMAIL_REGEX.test(value)) {
      return "Please enter a valid email address";
    }
  }

  if (type === "tel") {
    if (!PHONE_REGEX.test(value)) {
      return "Please enter a valid phone number";
    }
  }

  if (type === "number") {
    const num = parseFloat(value);
    if (isNaN(num)) return "Please enter a valid number";
    if (min !== undefined && num < min) {
      return `Must be at least ${min}`;
    }
    if (max !== undefined && num > max) {
      return `Must be at most ${max.toLocaleString()}`;
    }
  }

  if (maxLength !== undefined && value.length >= maxLength) {
    return "Character limit reached";
  }

  return undefined;
}

/** Max chars allowed in a number input, derived from the max prop */
function maxCharsForNumber(max: number | undefined, step: string | number | undefined): number {
  if (max === undefined) return 12;
  const hasDecimals = step !== undefined && step !== "1" && Number(step) < 1;
  return String(Math.floor(max)).length + (hasDecimals ? 3 : 0);
}

const ValidatedInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ onBlur, onChange, type, min, max, maxLength, step, value, ...props }, ref) => {
    const [error, setError] = React.useState<string | undefined>();

    const isNumber = type === "number";
    const minNum = min !== undefined ? Number(min) : undefined;
    const maxNum = max !== undefined ? Number(max) : undefined;

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      setError(validate(e.target.value, type, minNum, maxNum, maxLength));
      onBlur?.(e);
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (isNumber) {
        const val = e.target.value;
        // Only allow digits, minus, and decimal point
        if (val && !NUMERIC_REGEX.test(val)) return;
        const limit = maxCharsForNumber(maxNum, step);
        if (val.length > limit) return;
      }
      if (error) setError(undefined);
      onChange?.(e);
    }

    // Render number fields as type="text" with inputMode="decimal" to get
    // full control over input filtering (type="number" lets Safari accept letters)
    const renderedType = isNumber ? "text" : type;
    const inputMode = isNumber
      ? (step !== undefined && step !== "1" && Number(step) < 1 ? "decimal" as const : "numeric" as const)
      : props.inputMode;

    return (
      <Input
        ref={ref}
        type={renderedType}
        inputMode={inputMode}
        min={min}
        max={max}
        maxLength={maxLength}
        step={step}
        value={value}
        error={error}
        onBlur={handleBlur}
        onChange={handleChange}
        {...props}
      />
    );
  }
);
ValidatedInput.displayName = "ValidatedInput";

export { ValidatedInput };
