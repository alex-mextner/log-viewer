import { useCallback, useEffect, useState } from 'react';

interface UrlParams {
  from?: string;
  to?: string;
  level?: string[];
  pwd?: string;
  limit?: number;
  page?: number;
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaultFrom(): string {
  return `${getTodayDateString()}T00:00`;
}

function getDefaultTo(): string {
  return `${getTodayDateString()}T23:59`;
}

export function useUrlParams(): [UrlParams, (params: Partial<UrlParams>) => void] {
  const [params, setParamsState] = useState<UrlParams>(() => {
    if (typeof window === 'undefined') return {};

    const searchParams = new URLSearchParams(window.location.search);
    const limitStr = searchParams.get('limit');
    const pageStr = searchParams.get('page');
    return {
      from: searchParams.get('from') || getDefaultFrom(),
      to: searchParams.get('to') || getDefaultTo(),
      level: searchParams.get('level')?.split(',') || undefined,
      pwd: searchParams.get('pwd') || undefined,
      limit: limitStr ? parseInt(limitStr, 10) : undefined,
      page: pageStr ? parseInt(pageStr, 10) : undefined,
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
      if (updated.limit !== undefined) searchParams.set('limit', String(updated.limit));
      // page only makes sense with limit
      if (updated.limit !== undefined && updated.page !== undefined && updated.page > 1) {
        searchParams.set('page', String(updated.page));
      }

      const newUrl = `${window.location.pathname}?${searchParams.toString()}`;
      window.history.replaceState({}, '', newUrl);

      return updated;
    });
  }, []);

  // Sync with browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const limitStr = searchParams.get('limit');
      const pageStr = searchParams.get('page');
      setParamsState({
        from: searchParams.get('from') || undefined,
        to: searchParams.get('to') || undefined,
        level: searchParams.get('level')?.split(',') || undefined,
        pwd: searchParams.get('pwd') || undefined,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
        page: pageStr ? parseInt(pageStr, 10) : undefined,
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return [params, setParams];
}
