import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./Icon";
import s from "./Input.module.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ mono, className, ...rest }: InputProps) {
  return <input className={cx(s.input, mono && s.mono, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(s.input, className)} {...rest} />;
}

interface SearchProps extends Omit<InputProps, "onChange" | "value"> {
  value: string;
  onChange(value: string): void;
  /** Accessible name; also the placeholder unless one is given. */
  label: string;
  icon?: string;
}

/** Text input with a leading search glyph. */
export function SearchInput({ value, onChange, label, icon = "search", placeholder, className, ...rest }: SearchProps) {
  return (
    <label className={cx(s.search, className)}>
      <Icon name={icon} />
      <Input aria-label={label} placeholder={placeholder ?? label} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}
