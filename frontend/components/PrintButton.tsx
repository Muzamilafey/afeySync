'use client';

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="mb-4 rounded bg-slate-900 px-3 py-1.5 text-sm text-white print:hidden">
      Print
    </button>
  );
}
