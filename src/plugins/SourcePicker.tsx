import { Pill, PillGroup } from "@/components/ui";
import { chooseSource, useSource, useSources } from "@/hooks/useSource";

/** Switches the content source catalogs browse; hidden while only one is on. */
export function SourcePicker({ className }: { className?: string }) {
  const list = useSources();
  const current = useSource();
  if (list.length < 2) return null;
  return (
    <PillGroup label="Source" className={className}>
      {list.map((s) => (
        <Pill key={s.id} pressed={s.id === current?.id} onClick={() => chooseSource(s.id)}>
          {s.name}
        </Pill>
      ))}
    </PillGroup>
  );
}
