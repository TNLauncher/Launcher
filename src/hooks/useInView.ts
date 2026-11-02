import { useEffect, useRef, useState, type RefObject } from "react";

/** True once the element has come within `margin` of the visible area; stays true after. Root is the app's scroller,
 *  since a margin on the viewport would be clipped away by `<main>`. */
export function useInView<T extends Element>(margin = "600px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setSeen(true), { root: el.closest("main"), rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}
