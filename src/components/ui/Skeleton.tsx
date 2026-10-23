import { cx } from "@/lib/cx";
import s from "./Skeleton.module.css";

export function Skeleton({ height, width, className }: { height?: number | string; width?: number | string; className?: string }) {
  return <div className={cx(s.skeleton, className)} style={{ height, width }} />;
}
