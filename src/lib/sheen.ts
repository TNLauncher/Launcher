// One delegated listener drives the `.sheen` hover light (base.css): the card under the pointer gets
// its local pointer position as --mx/--my, at most once per frame. No per-card handlers or React state.
let frame = 0;
let last: PointerEvent | null = null;

function paint() {
  frame = 0;
  const el = (last?.target as Element | null)?.closest?.<HTMLElement>(".sheen");
  if (!el || !last) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${last.clientX - r.left}px`);
  el.style.setProperty("--my", `${last.clientY - r.top}px`);
}

if (!matchMedia("(pointer: coarse)").matches) {
  document.addEventListener(
    "pointermove",
    (e) => {
      last = e;
      frame ||= requestAnimationFrame(paint);
    },
    { passive: true }
  );
}
