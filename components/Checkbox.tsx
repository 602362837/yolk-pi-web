"use client";

import { useId, useState } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  label?: ReactNode;
  rootStyle?: CSSProperties;
  size?: number;
}

const hiddenInputStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function Checkbox({
  label,
  rootStyle,
  size = 16,
  checked,
  defaultChecked,
  disabled,
  id,
  onBlur,
  onChange,
  onFocus,
  ...inputProps
}: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [internalChecked, setInternalChecked] = useState(Boolean(defaultChecked));
  const isControlled = checked !== undefined;
  const isChecked = isControlled ? Boolean(checked) : internalChecked;
  const checkSize = Math.max(8, Math.round(size * 0.68));

  return (
    <label
      htmlFor={inputId}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        color: "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        userSelect: "none",
        lineHeight: 1.35,
        ...rootStyle,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <input
        {...inputProps}
        id={inputId}
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          if (!isControlled) setInternalChecked(event.currentTarget.checked);
          onChange?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        style={hiddenInputStyle}
      />
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          flex: `0 0 ${size}px`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Math.max(4, Math.round(size * 0.32)),
          border: `1px solid ${isChecked
            ? "color-mix(in srgb, var(--accent) 72%, var(--border))"
            : hovered && !disabled
              ? "color-mix(in srgb, var(--accent) 45%, var(--border))"
              : "var(--border)"}`,
          background: isChecked
            ? "linear-gradient(135deg, var(--accent), var(--accent-hover))"
            : hovered && !disabled
              ? "color-mix(in srgb, var(--accent) 7%, var(--bg))"
              : "var(--bg)",
          boxShadow: focused
            ? "0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)"
            : isChecked
              ? "0 5px 12px color-mix(in srgb, var(--accent) 22%, transparent)"
              : "inset 0 1px 0 rgba(255,255,255,0.08)",
          color: "#fff",
          transform: isChecked ? "scale(1)" : hovered && !disabled ? "scale(1.04)" : "scale(1)",
          transition: "background 0.14s, border-color 0.14s, box-shadow 0.14s, transform 0.14s",
        }}
      >
        <svg
          width={checkSize}
          height={checkSize}
          viewBox="0 0 16 16"
          fill="none"
          style={{
            opacity: isChecked ? 1 : 0,
            transform: isChecked ? "scale(1)" : "scale(0.75)",
            transition: "opacity 0.12s, transform 0.12s",
          }}
        >
          <path
            d="M3.4 8.2 6.5 11.2 12.8 4.8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {label && <span style={{ minWidth: 0 }}>{label}</span>}
    </label>
  );
}
