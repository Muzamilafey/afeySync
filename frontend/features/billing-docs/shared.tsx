'use client';

import { useEffect, useState } from 'react';
import { apiRaw } from '@/services/api';
import type { Realm } from '@/stores/session';
import { Loading } from '@/components/ui';

export type DocStatus = 'draft' | 'issued' | 'accepted' | 'declined' | 'partially_paid' | 'paid' | 'void' | 'expired';
export type DocType = 'quotation' | 'invoice' | 'contract';
export interface DocLine { description: string; quantity: number; unitPrice: number; amount: number; kind: 'subscription' | 'setup' | 'service' | 'other'; planKey?: string; billingCycle?: string }
export interface BillingDocument {
  _id: string; type: DocType; number: string; status: DocStatus; tenantId?: string; currency: string;
  customer: { name?: string; contactName?: string; email?: string; phone?: string; address?: string; kraPin?: string };
  lines: DocLine[]; subtotal: number; vatRate: number; vatAmount: number; total: number; amountPaid: number; balance: number;
  issueDate?: string; dueDate?: string; validUntil?: string; notes?: string; terms?: string;
  contract?: { planKey: string; billingCycle: string; amount: number; startDate: string; termMonths: number; specialTerms?: string; body?: string };
  signing?: { signedAt?: string; signatoryName?: string; signatoryTitle?: string; hash?: string; stampAssetId?: string; signatureAssetId?: string };
  acceptance?: { at?: string; byName?: string; byTitle?: string; byEmail?: string; ip?: string };
  sourceQuotationId?: string; convertedInvoiceId?: string; subscriptionAppliedAt?: string; sentAt?: string; sentTo?: string; voidReason?: string;
  history: Array<{ at: string; action: string; byName?: string; note?: string }>;
  payments?: Payment[]; contractPreview?: string; createdAt: string;
}
export interface Payment { _id: string; method: string; amount: number; status: 'pending' | 'completed' | 'failed'; reference?: string; receivedAt?: string; createdAt: string; recordedByName?: string; initiatedBy?: string; notes?: string; mpesa?: { phone?: string; receiptNumber?: string; resultDesc?: string; billRef?: string; payerName?: string }; document?: { _id: string; number: string; customer?: { name?: string } } | null }

export const TYPE_LABEL: Record<DocType, string> = { quotation: 'Quotation', invoice: 'Invoice', contract: 'Agreement' };
export const STATUS_TONE: Record<DocStatus, 'gray' | 'blue' | 'green' | 'amber' | 'red'> = { draft: 'gray', issued: 'blue', accepted: 'green', declined: 'red', partially_paid: 'amber', paid: 'green', void: 'red', expired: 'gray' };
export const CYCLES = [{ key: 'monthly', label: 'Monthly' }, { key: 'quarterly', label: 'Quarterly' }, { key: 'annual', label: 'Annual' }] as const;
export const money = (n: number | undefined, cur = 'KES') => `${cur} ${(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Renders an authenticated PDF (never exposes the token in a URL). */
export function PdfPreview({ path, realm, version, height = 820 }: { path: string; realm: Realm; version?: string; height?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let href: string | null = null;
    let live = true;
    setUrl(null);
    apiRaw(path, { realm })
      .then((r) => r.blob())
      .then((b) => { if (!live) return; href = URL.createObjectURL(b); setUrl(href); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; if (href) URL.revokeObjectURL(href); };
  }, [path, realm, version]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!url) return <Loading label="Preparing PDF…" />;
  return <iframe title="Document preview" src={url} className="w-full rounded-lg border border-[var(--border)] bg-white" style={{ height }} />;
}

/** An image served by an authenticated endpoint. */
export function AuthImage({ path, realm, alt, className }: { path: string; realm: Realm; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let href: string | null = null;
    apiRaw(path, { realm }).then((r) => r.blob()).then((b) => { href = URL.createObjectURL(b); setUrl(href); }).catch(() => setUrl(null));
    return () => { if (href) URL.revokeObjectURL(href); };
  }, [path, realm]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} className={className} /> : <div className={className} />;
}
