'use client';

import { useQuery } from '@tanstack/react-query';
import { ownerApi } from '@/services/api';
import { Alert, Badge, Card, ErrorText, KV, Loading, PageHeader, Stat, Table, Td } from '@/components/ui';
import { ago, fmtDateTime } from '@/lib/utils';

interface Facility { tenantId: string; name: string; slug: string; status: string; dbName?: string; lastBackupAt: string | null; stale: boolean; lastRunFailed: boolean }
interface Run { _id: string; dbName: string; status: string; file?: string; sizeBytes?: number; host?: string; createdAt: string }
interface Data { staleAfterHours: number; metaLastBackupAt: string | null; facilities: Facility[]; recentRuns: Run[] }

const mb = (b?: number) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : '—');

export default function BackupsPage() {
  const q = useQuery({ queryKey: ['owner-backups'], queryFn: async () => (await ownerApi<Data>('/backups')).data, refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorText error={q.error} />;
  const d = q.data;
  const stale = d.facilities.filter((f) => f.stale);
  const failed = d.facilities.filter((f) => f.lastRunFailed);
  return (
    <>
      <PageHeader title="Backups" subtitle="Encrypted per-database backups written by deploy/backup.sh" crumbs={['Platform', 'Backups']} />
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Facilities" value={d.facilities.length} />
        <Stat label={`Stale (> ${d.staleAfterHours} h)`} value={stale.length} tone={stale.length ? 'red' : 'green'} />
        <Stat label="Last run failed" value={failed.length} tone={failed.length ? 'red' : 'green'} />
        <Stat label="Platform DB" value={d.metaLastBackupAt ? ago(d.metaLastBackupAt) : 'never'} tone={d.metaLastBackupAt ? 'green' : 'red'} />
      </div>
      {d.recentRuns.length === 0 && (
        <Alert tone="amber" title="No backup runs recorded">
          Schedule <code>deploy/backup.sh all</code> with cron on the database host (see docs/DEPLOYMENT.md). Each run records its result here. Keep the backup key off the server and test restores with <code>backup.sh verify</code>.
        </Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Facilities">
          <Table head={['Facility', 'Database', 'Last backup', 'State']} empty={d.facilities.length === 0}>
            {d.facilities.map((f) => (
              <tr key={f.tenantId}>
                <Td className="font-medium">{f.name}<span className="muted block text-xs">{f.slug} · {f.status}</span></Td>
                <Td className="font-mono text-xs">{f.dbName ?? '—'}</Td>
                <Td className="text-xs">{f.lastBackupAt ? <>{fmtDateTime(f.lastBackupAt)}<span className="muted block">{ago(f.lastBackupAt)}</span></> : 'never'}</Td>
                <Td>{f.lastRunFailed ? <Badge tone="red">last run failed</Badge> : f.stale ? <Badge tone="amber">stale</Badge> : <Badge tone="green">ok</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Recent runs">
          <Table head={['Time', 'Database', 'Result', 'Size', 'Host']} empty={d.recentRuns.length === 0}>
            {d.recentRuns.map((r) => (
              <tr key={r._id}>
                <Td className="text-xs">{fmtDateTime(r.createdAt)}</Td>
                <Td className="font-mono text-xs">{r.dbName}</Td>
                <Td><Badge tone={r.status === 'success' ? 'green' : 'red'}>{r.status}</Badge></Td>
                <Td className="text-xs">{mb(r.sizeBytes)}</Td>
                <Td className="text-xs">{r.host ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="Policy" className="mt-5">
        <KV items={[['Encryption', 'AES-256 (openssl, PBKDF2 200k iterations), key file kept off-server'], ['Integrity', 'SHA-256 checksum per archive; verify performs a dry-run restore'], ['Retention', 'RETENTION_DAYS (default 14) on the backup host'], ['Isolation', 'One archive per facility database, so a single facility can be restored alone']]} />
      </Card>
    </>
  );
}
