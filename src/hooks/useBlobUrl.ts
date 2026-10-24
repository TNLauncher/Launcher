import { useEffect, useState } from "react";

/** Object URL for image bytes fetched over IPC, revoked when `key` changes; null while loading, on failure, or for a null key. */
export function useBlobUrl(key: string | null, load: () => Promise<ArrayBuffer>): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    let made: string | undefined;
    load()
      .then((bytes) => live && setUrl((made = URL.createObjectURL(new Blob([bytes])))))
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
    // `load` is a fresh closure every render; `key` identifies what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}
