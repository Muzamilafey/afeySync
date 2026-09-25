export const THEME_KEY = 'afs-theme';

/** Runs before the page paints (see app/layout.tsx) so the chosen theme never flashes. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
