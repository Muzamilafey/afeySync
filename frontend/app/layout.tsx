import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

const domain = (process.env.PLATFORM_DOMAIN ?? 'localhost').toLowerCase();

export const metadata: Metadata = {
  // Absolute links for canonical URLs and social previews.
  metadataBase: new URL(domain === 'localhost' ? 'http://localhost:3000' : `https://${domain}`),
  title: 'AfeySync HMIS',
  description: 'AfeySync — multi-tenant Hospital Management Information System for Kenyan facilities',
  applicationName: 'AfeySync',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'AfeySync', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#0b8a72' }, { media: '(prefers-color-scheme: dark)', color: '#0b1220' }],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
