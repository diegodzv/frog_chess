import { useEffect, useState } from 'react';

/** Fetches a static JSON file relative to the current page, bypassing the HTTP cache. */
export function useJson(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(path, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error };
}
