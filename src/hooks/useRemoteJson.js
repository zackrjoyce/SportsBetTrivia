import { useEffect, useState } from "react";

export function useRemoteJson(url) {
  const [data, setData] = useState(null);
  const [error, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(url, { headers: { Accept: "application/json" }, signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) {
        if (e.name !== "AbortError") setErr(e);
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [url]);

  return { data, error, loading };
}