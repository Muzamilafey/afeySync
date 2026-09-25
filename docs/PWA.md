# Installable app (PWA)

AfeySync can be installed as an app on desktops, Android devices, iPhones and iPads, and opens
full screen from its icon.

* **Where to install:**
  * Each facility's sign-in page and the owner-portal sign-in page show an **Install AfeySync**
    card.
  * The top bar of the facility app and of the owner portal has an **Install app** button.
  * Chrome, Edge and Android show the native install prompt. On iPhone and iPad, Safari has no
    prompt, so the button shows the *Share → Add to Home Screen* steps.
  * The button is hidden once the app is installed.
* **One app per address:** each facility web address (and custom domain) installs as its own
  “AfeySync” app, opening at the dashboard. The owner portal installs as “AfeySync Owner”. The
  manifest (`/manifest.webmanifest`) is generated per host and includes shortcuts: Register patient,
  Patients and Billing for facilities; Facilities and Billing for the owner.
* **Patient data is never stored on the device.** The service worker (`/sw.js`) does not touch
  `/api/*` and does not cache pages. It caches only content-hashed build files, icons and an
  offline page. Without a connection, the app shows “You're offline” and reloads by itself when
  the connection returns.
* **Updates:** when a new version is deployed, users see “A new version of AfeySync is available ·
  Refresh”. The page reloads only when they click Refresh, never in the middle of their work.
* **Requirements:** service workers need HTTPS (or `localhost` in development). `sw.js` is served
  with `Cache-Control: no-cache`, so updates are picked up promptly; the nginx config proxies it
  through unchanged.
* **Icons:** in `frontend/public/icons`: 192 and 512 px, maskable 192 and 512 px, Apple touch
  icon 180 px and favicons. Replace them with your final artwork at the same sizes.
