import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateFilter } from '@/components/DateFilter';
import { LevelFilter } from '@/components/LevelFilter';
import { LogViewer } from '@/components/LogViewer';
import { useLogs, type LogEntry } from '@/hooks/useLogs';
import { useUrlParams } from '@/hooks/useUrlParams';
import './index.css';

export interface AppProps {
  initialLogs?: LogEntry[];
  initialPassword?: string;
}

export function App({ initialLogs, initialPassword }: AppProps = {}) {
  const [params, setParams] = useUrlParams();
  const [passwordInput, setPasswordInput] = useState(initialPassword || params.pwd || '');
  const [password, setPassword] = useState(initialPassword || params.pwd || '');

  const filter = useMemo(
    () => ({
      from: params.from,
      to: params.to,
      level: params.level,
    }),
    [params.from, params.to, params.level]
  );

  const { logs, loading, error, refresh, streaming } = useLogs({
    password,
    filter,
    autoRefresh: true,
    initialLogs,
  });

  const handleLogin = () => {
    setPassword(passwordInput);
    setParams({ pwd: passwordInput });
  };

  const handleDateChange = (from?: string, to?: string) => {
    setParams({ from, to });
  };

  const handleLevelChange = (level: string[]) => {
    setParams({ level: level.length > 0 ? level : undefined });
  };

  // Login screen
  if (!password) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Log Viewer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Enter password"
              />
            </div>
            <Button onClick={handleLogin} className="w-full">
              View Logs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background p-4">
      {/* Header */}
      <div className="mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Log Viewer</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPassword('');
                setParams({ pwd: undefined });
              }}
            >
              Logout
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <DateFilter from={params.from} to={params.to} onChange={handleDateChange} />
          <LevelFilter selected={params.level || []} onChange={handleLevelChange} />
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-destructive/10 text-destructive px-4 py-2 rounded text-sm">{error}</div>
        )}
      </div>

      {/* Log viewer */}
      <LogViewer logs={logs} loading={loading} streaming={streaming} />
    </div>
  );
}

export default App;
