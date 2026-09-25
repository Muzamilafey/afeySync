import { NextResponse, type NextRequest } from 'next/server';

/**
 * The public website address (afey.co.ke, www.afey.co.ke) serves only the website. App pages opened
 * there, for example from browser history or an app installed before the website existed, go to the
 * home page; sign-in pages go to the accounts address. Other addresses pass straight through.
 */
const WEBSITE_PAGES = new Set(['/', '/features', '/pricing', '/user-guide', '/security', '/about', '/contact', '/privacy', '/get-started']);
const SIGN_IN_PAGES = new Set(['/login', '/forgot-password', '/reset-password']);

export function proxy(request: NextRequest) {
  const apex = (process.env.PLATFORM_DOMAIN ?? 'localhost').toLowerCase();
  const hostHeader = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim();
  const host = hostHeader.split(':')[0].toLowerCase();
  if (host !== apex && host !== `www.${apex}`) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (WEBSITE_PAGES.has(pathname) || /^\/(blog|user-guide)(\/[a-z0-9-]+)?$/.test(pathname) || pathname.startsWith('/opengraph-image')) return NextResponse.next();

  const port = hostHeader.includes(':') ? `:${hostHeader.split(':').pop()}` : '';
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || (apex === 'localhost' ? 'http' : 'https');
  const target = SIGN_IN_PAGES.has(pathname) ? `${proto}://accounts.${apex}${port}${pathname}${search}` : `${proto}://${hostHeader}/`;
  return NextResponse.redirect(target, 307);
}

export const config = {
  // Everything except the API, build assets and files (robots.txt, sitemap.xml, sw.js, icons, images…).
  matcher: ['/((?!api/|_next/|.*\\.[a-z0-9]+$).*)'],
};
