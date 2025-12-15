import { Button } from '@/components/ui/button';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

const LEVEL_COLORS: Record<string, string> = {
  debug: 'bg-gray-500',
  info: 'bg-blue-500',
  warn: 'bg-yellow-500',
  error: 'bg-red-500',
};

interface LevelFilterProps {
  selected: string[];
  onChange: (levels: string[]) => void;
}

export function LevelFilter({ selected, onChange }: LevelFilterProps) {
  const toggle = (level: string) => {
    if (selected.includes(level)) {
      onChange(selected.filter((l) => l !== level));
    } else {
      onChange([...selected, level]);
    }
  };

  const allSelected = selected.length === 0 || selected.length === LEVELS.length;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={allSelected ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange([])}
        className="text-xs"
      >
        All
      </Button>
      {LEVELS.map((level) => {
        const isSelected = selected.length === 0 || selected.includes(level);
        return (
          <Button
            key={level}
            variant={isSelected ? 'default' : 'outline'}
            size="sm"
            onClick={() => toggle(level)}
            className="text-xs"
          >
            <span className={`w-2 h-2 rounded-full mr-1 ${LEVEL_COLORS[level]}`} />
            {level.toUpperCase()}
          </Button>
        );
      })}
    </div>
  );
}
