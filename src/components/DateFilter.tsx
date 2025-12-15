import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DateFilterProps {
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
}

export function DateFilter({ from, to, onChange }: DateFilterProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="from" className="text-sm whitespace-nowrap">
          From:
        </Label>
        <Input
          id="from"
          type="datetime-local"
          value={from || ''}
          onChange={(e) => onChange(e.target.value || undefined, to)}
          className="w-48"
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="to" className="text-sm whitespace-nowrap">
          To:
        </Label>
        <Input
          id="to"
          type="datetime-local"
          value={to || ''}
          onChange={(e) => onChange(from, e.target.value || undefined)}
          className="w-48"
        />
      </div>
    </div>
  );
}
