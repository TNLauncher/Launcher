import type { CSSProperties } from "react";

interface Props {
  name: string;
  fill?: boolean;
  size?: number;
  spin?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Material Symbols glyph. */
export function Icon({ name, fill, size, spin, className = "", style }: Props) {
  const cls = ["icon", fill && "fill", spin && "spin", className].filter(Boolean).join(" ");
  return (
    <i className={cls} style={size ? { fontSize: size, ...style } : style} aria-hidden="true">
      {name}
    </i>
  );
}
