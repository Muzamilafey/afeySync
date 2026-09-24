'use client';

import { Badge, Table, Td } from '@/components/ui';
import { FLAG_TONE, type LabItem } from './types';

export function ResultsTable({ item }: { item: LabItem }) {
  return (
    <Table head={['Parameter', 'Result', 'Unit', 'Reference', 'Flag']}>
      {item.results.map((r) => (
        <tr key={r.parameter} className={r.critical ? 'bg-red-50 dark:bg-red-950/30' : ''}>
          <Td>{r.name}</Td>
          <Td className="font-semibold">{r.value}</Td>
          <Td>{r.unit}</Td>
          <Td className="muted">{r.referenceRange}</Td>
          <Td>{r.flag && <Badge tone={FLAG_TONE[r.flag] ?? 'gray'}>{r.critical ? `CRITICAL ${r.flag}` : r.flag}</Badge>}</Td>
        </tr>
      ))}
    </Table>
  );
}
