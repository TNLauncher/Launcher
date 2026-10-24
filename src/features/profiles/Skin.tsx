import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { launcher } from "@/api/launcher";
import { cx } from "@/lib/cx";
import type { Account, Skin } from "@/types";
import { readySheets, skinSheet } from "./texture";
import s from "./skin.module.css";

/** The account's skin; null offline or when it has none (or it failed to load), undefined while loading. */
export function useSkin(account: Account | null | undefined): Skin | null | undefined {
  const q = useQuery({
    queryKey: ["skin", account?.id],
    queryFn: () => launcher.accountSkin(account!.id),
    enabled: !!account,
    staleTime: Infinity,
  });
  if (!account) return null;
  return q.isPending ? undefined : q.data ?? null;
}

/** The normalized sheet: undefined while the skin or its sheet is on the way, null when there is none to show. */
function useSheet(skin: Skin | null | undefined): string | null | undefined {
  const texture = skin?.texture;
  const [sheet, setSheet] = useState<{ for: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!texture || readySheets.has(texture)) return;
    let live = true;
    skinSheet(texture).then((url) => live && setSheet({ for: texture, url }));
    return () => void (live = false);
  }, [texture]);
  if (skin === undefined) return undefined;
  if (!texture) return null;
  if (readySheets.has(texture)) return readySheets.get(texture)!;
  return sheet?.for === texture ? sheet.url : undefined;
}

type V2 = [number, number];
type V3 = [number, number, number];
interface Part {
  name: string;
  /** Pivot in skin pixels from the model's center, y down: limbs swing from the top, the head turns on the neck. */
  at: V2;
  hang: "down" | "up" | "center";
  box: V3;
  base: V2;
  over: V2;
  /** How far the second layer stands off the first, in skin pixels (the game uses 0.5 for the hat, 0.25 elsewhere). */
  inflate: number;
}

function parts(slim: boolean): Part[] {
  const a = slim ? 3 : 4;
  return [
    { name: "head", at: [0, -8], hang: "up", box: [8, 8, 8], base: [0, 0], over: [32, 0], inflate: 0.5 },
    { name: "body", at: [0, -2], hang: "center", box: [8, 12, 4], base: [16, 16], over: [16, 32], inflate: 0.25 },
    { name: "armR", at: [-(4 + a / 2), -8], hang: "down", box: [a, 12, 4], base: [40, 16], over: [40, 32], inflate: 0.25 },
    { name: "armL", at: [4 + a / 2, -8], hang: "down", box: [a, 12, 4], base: [32, 48], over: [48, 48], inflate: 0.25 },
    { name: "legR", at: [-2, 4], hang: "down", box: [4, 12, 4], base: [0, 16], over: [0, 32], inflate: 0.25 },
    { name: "legL", at: [2, 4], hang: "down", box: [4, 12, 4], base: [16, 48], over: [0, 48], inflate: 0.25 },
  ];
}

/** Minecraft's box UV net: the six faces of a w×h×d box whose texture starts at (u, v). */
function faces([w, h, d]: V3, [u, v]: V2) {
  return [
    { side: "front", size: [w, h], uv: [u + d, v + d], turn: "", depth: d / 2 },
    { side: "back", size: [w, h], uv: [u + 2 * d + w, v + d], turn: "rotateY(180deg)", depth: d / 2 },
    { side: "right", size: [d, h], uv: [u + d + w, v + d], turn: "rotateY(90deg)", depth: w / 2 },
    { side: "left", size: [d, h], uv: [u, v + d], turn: "rotateY(-90deg)", depth: w / 2 },
    { side: "top", size: [w, d], uv: [u + d, v], turn: "rotateX(90deg)", depth: h / 2 },
    { side: "bottom", size: [w, d], uv: [u + d + w, v], turn: "rotateX(-90deg)", depth: h / 2 },
  ] as const;
}

/** `seam`: base faces grow by this many screen pixels so neighbors overlap and no background shows at the edges. */
function Box({ box, uv, px, y, inflate = 0, textured, seam = 0 }: { box: V3; uv: V2; px: number; y: number; inflate?: number; textured: boolean; seam?: number }) {
  const [sx, sy, sz] = box.map((n) => (n + 2 * inflate) / n);
  return (
    <div className={s.box} style={{ transform: `translateY(${y * px}px) scale3d(${sx}, ${sy}, ${sz})` }}>
      {faces(box, uv).map((f) => {
        const [fw, fh] = [f.size[0] * px, f.size[1] * px];
        return (
          <div
            key={f.side}
            className={cx(s.face, s[f.side], !textured && s.bare)}
            style={{
              width: fw,
              height: fh,
              // -1: the antialiasing border (skin.module.css) sits outside the face.
              left: -fw / 2 - 1,
              top: -fh / 2 - 1,
              transform: `${f.turn} translateZ(${f.depth * px}px)${seam ? ` scale(${(fw + seam) / fw}, ${(fh + seam) / fh})` : ""}`,
              backgroundPosition: textured ? `${-f.uv[0] * px}px ${-f.uv[1] * px}px` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

const REST = { x: -8, y: -28 };
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A Minecraft player in CSS 3D: drag (with a little momentum) or use the arrow keys to turn it, double-click or
 * Home to face front again. Without a skin it is a plain silhouette.
 */
export function SkinModel({ skin, px, label, onTurn }: { skin: Skin | null | undefined; px: number; label: string; onTurn?(): void }) {
  const sheet = useSheet(skin);
  const scene = useRef<HTMLDivElement>(null);
  const model = useRef<HTMLDivElement>(null);
  const turn = useRef({ ...REST });
  const drag = useRef<{ x: number; y: number; t: number; v: number } | null>(null);
  const spin = useRef(0);
  const [dragging, setDragging] = useState(false);
  // The window hides while the game runs; the idle loop should not keep the compositor busy behind it.
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const apply = () => {
    if (model.current) model.current.style.transform = `rotateX(${turn.current.x}deg) rotateY(${turn.current.y}deg)`;
    scene.current?.setAttribute("aria-valuenow", String(Math.round(((turn.current.y % 360) + 360) % 360)));
  };
  const rotate = (dx: number, dy: number) => {
    onTurn?.();
    turn.current.y += dx;
    turn.current.x = Math.max(-35, Math.min(35, turn.current.x + dy));
    apply();
  };
  const reset = () => {
    cancelAnimationFrame(spin.current);
    turn.current = { ...REST };
    apply();
  };
  // A new skin swings in from the resting angle, not from wherever the last one was left.
  useEffect(() => {
    cancelAnimationFrame(spin.current);
    turn.current = { ...REST };
  }, [sheet]);
  // The model element is new after each remount (skin change), so re-apply the angle every render.
  useEffect(apply);
  useEffect(() => () => cancelAnimationFrame(spin.current), []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(spin.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, v: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * 0.6;
    rotate(dx, -(e.clientY - d.y) * 0.3);
    // Degrees per ms, smoothed so one jittery sample does not decide the fling.
    d.v = 0.7 * d.v + (0.3 * dx) / Math.max(1, e.timeStamp - d.t);
    Object.assign(d, { x: e.clientX, y: e.clientY, t: e.timeStamp });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || reducedMotion()) return;
    // Coast: the release speed decays to rest in about half a second.
    let v = d.v * 16;
    const coast = () => {
      if (Math.abs(v) < 0.05) return;
      rotate(v, 0);
      v *= 0.92;
      spin.current = requestAnimationFrame(coast);
    };
    spin.current = requestAnimationFrame(coast);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = ({ ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] } as Record<string, V2>)[e.key];
    if (step) rotate(...step);
    else if (e.key === "Home") reset();
    else return;
    e.preventDefault();
  };

  const textured = !!sheet;
  return (
    <div
      ref={scene}
      className={cx(s.scene, (dragging || hidden) && s.still)}
      style={{ "--skin": sheet ? `url("${sheet}")` : "none", "--sheet": `${64 * px}px`, width: 20 * px, height: 36 * px } as CSSProperties}
      role="slider"
      aria-roledescription="turntable"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    >
      {/* Keyed so a new skin swings in once it is ready; nothing is drawn while it loads. */}
      {sheet !== undefined && <div key={sheet ?? "bare"} className={s.enter}>
        <div ref={model} className={s.model}>
          {parts(!!skin?.slim).map((p) => {
            const y = p.hang === "down" ? p.box[1] / 2 : p.hang === "up" ? -p.box[1] / 2 : 0;
            return (
              <div key={p.name} className={s.joint} style={{ transform: `translate3d(${p.at[0] * px}px, ${p.at[1] * px}px, 0)` }}>
                <div className={cx(s.limb, s[p.name])}>
                  <Box box={p.box} uv={p.base} px={px} y={y} textured={textured} seam={1} />
                  {textured && <Box box={p.box} uv={p.over} px={px} y={y} inflate={p.inflate} textured />}
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

/** The face and hat layer, flat; the first letter of the name when there is no skin. */
export function SkinHead({ skin, name, size, className }: { skin: Skin | null | undefined; name: string; size: number; className?: string }) {
  const sheet = useSheet(skin);
  const k = size / 8;
  const layer = (u: number): CSSProperties => ({ backgroundImage: `url("${sheet}")`, backgroundSize: `${64 * k}px auto`, backgroundPosition: `${-u * k}px ${-8 * k}px` });
  return (
    <span className={cx(s.avatar, className)} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {sheet ? (
        <>
          <span style={layer(8)} />
          <span className={s.hat} style={layer(40)} />
        </>
      ) : (
        sheet === null && (name[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}
