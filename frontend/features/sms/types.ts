export interface SmsWallet {
  balance: number;
  status: 'ok' | 'low' | 'empty';
  pricePerSms: number;
  lowBalanceCredits: number;
  minTopupKes: number;
  maxTopupKes: number;
  usedLast30Days: number;
  welcome: { credits: number; at: string } | null;
  mpesa: { available: boolean; paybill: string | null; accountRef: string };
}
export interface SmsLedgerRow { _id: string; type: 'welcome' | 'topup' | 'debit' | 'refund' | 'adjustment'; credits: number; balanceAfter?: number; note?: string; byName?: string; createdAt: string }
