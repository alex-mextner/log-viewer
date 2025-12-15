import { useState, useEffect, useCallback } from 'react';

interface UrlParams {
  from?: string;
  to?: string;
  level?: string[];
  pwd?: string;
}

export function useUrlParams(): [UrlParams, (params: Partial<UrlParams>) => void] {
  const [params, setParamsState] = useState<UrlParams>(() => {
    if (typeof window === 'undefined') return {};

    const searchParams = new URLSearchParams(window.location.search);
    return {
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      level: searchParams.get('level')?.split(',') || undefined,
      pwd: searchParams.get('pwd') || undefined,
    };
  });

  const setParams = useCallback((newParams: Partial<UrlParams>) => {
    setParamsState((prev) => {
      const updated = { ...prev, ...newParams };

      // Update URL
      const searchParams = new URLSearchParams();
      if (updated.pwd) searchParams.set('pwd', updated.pwd);
      if (updated.from) searchParams.set('from', updated.from);
      if (updated.to) searchParams.set('to', updated.to);
      if (updated.level?.length) searchParams.set('level', updated.level.join(','));

      const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
      window.history.replaceState({}, '', newUrl);

      return updated;
    });
  }, []);

  // Sync with browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search);
      setParamsState({
        from: searchParams.get('from') || undefined,
        to: searchParams.get('to') || undefined,
        level: searchParams.get('level')?.split(',') || undefined,
        pwd: searchParams.get('pwd') || undefined,
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return [params, setParams];
}
