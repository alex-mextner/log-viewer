import { Button } from '@/components/ui/button';

interface PaginationProps {
  total: number;
  limit?: number;
  page?: number;
  onLimitChange: (limit: number | undefined) => void;
  onPageChange: (page: number) => void;
}

const LIMIT_OPTIONS = [100, 500, 1000, 5000];

export function Pagination({ total, limit, page = 1, onLimitChange, onPageChange }: PaginationProps) {
  const hasLimit = limit !== undefined;
  const totalPages = hasLimit ? Math.ceil(total / limit) : 1;
  const currentPage = hasLimit ? Math.min(page, totalPages) || 1 : 1;
  const startEntry = hasLimit ? (currentPage - 1) * limit + 1 : 1;
  const endEntry = hasLimit ? Math.min(currentPage * limit, total) : total;

  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      {/* Entry count and range */}
      <span className="text-muted-foreground">
        {total > 0 ? (hasLimit ? `${startEntry}-${endEntry} of ${total}` : `${total} entries`) : '0 entries'}
      </span>

      {/* Page navigation - only when limit is set and multiple pages */}
      {hasLimit && totalPages > 1 && (
        <>
          <span className="text-muted-foreground">|</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            ←
          </Button>
          <span className="text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            →
          </Button>
        </>
      )}

      {/* Limit selector - always visible */}
      <span className="text-muted-foreground">|</span>
      <span className="text-muted-foreground">Per page:</span>
      {LIMIT_OPTIONS.map((opt) => (
        <Button
          key={opt}
          variant={limit === opt ? 'default' : 'outline'}
          size="sm"
          className="h-7 px-2"
          onClick={() => {
            onLimitChange(opt);
            onPageChange(1);
          }}
        >
          {opt}
        </Button>
      ))}
      <Button
        variant={!hasLimit ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-2"
        onClick={() => onLimitChange(undefined)}
      >
        All
      </Button>
    </div>
  );
}
