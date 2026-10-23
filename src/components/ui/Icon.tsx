import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";

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
  return (
    <i className={cx("icon", fill && "fill", spin && "spin", className)} style={size ? { fontSize: size, ...style } : style} aria-hidden="true">
      {name}
    </i>
  );
}
