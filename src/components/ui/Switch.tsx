import s from "./Switch.module.css";

interface Props {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  name?: string;
}

export function Switch({ checked, onChange, label, name }: Props) {
  return (
    <span className={s.switch} title={label}>
      <input type="checkbox" name={name} aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={s.track} />
    </span>
  );
}
