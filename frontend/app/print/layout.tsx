export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">{children}</div>;
}
