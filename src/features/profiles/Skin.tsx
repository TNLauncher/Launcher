import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { launcher } from "@/api/launcher";
import { cx } from "@/lib/cx";
import type { Account, Skin } from "@/types";
import { readySheets, skinSheet } from "./texture";
import s from "./skin.module.css";

/** The account's skin; null offline or when it has none (or it failed to load), undefined while loading. */
export function useSkin(account: Account | null | undefined): Skin | null | undefined {
  const online = !!account && account.provider !== "offline";
  const q = useQuery({
    queryKey: ["skin", account?.id],
    queryFn: () => launcher.accountSkin(account!.id),
    enabled: online,
    staleTime: Infinity,
  });
  if (!online) return null;
  return q.isPending ? undefined : q.data ?? null;
}

/** The normalized sheet: undefined while the skin or its sheet is on the way, null when there is none to show. */
export function useSheet(skin: Skin | null | undefined): string | null | undefined {
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
