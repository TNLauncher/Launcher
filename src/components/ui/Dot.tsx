import { cx } from "@/lib/cx";
import s from "./Dot.module.css";

export type Tone = "neutral" | "green" | "blue" | "orange" | "red";

/** Status indicator. */
export function Dot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span className={cx(s.dot, tone !== "neutral" && s[tone], className)} />;
}
