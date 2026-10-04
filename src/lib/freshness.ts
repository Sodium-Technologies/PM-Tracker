import React from 'react';

/** The bundle this page is running, by file name — assets/index-AbC123.js. Vite
 *  gives every build a new name, so two names that differ are two versions. */
const runningBundle = (): string | null => {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return el?.getAttribute('src')?.split('/').pop() ?? null;
};

/** Notice when a newer version has been deployed than the one on screen.
 *
 *  A page left open — and above all a phone's home-screen app, which the system
 *  suspends rather than closes — can go on running a build that has long since
 *  been replaced, with nothing to say so. Each time the page comes back to the
 *  foreground, and every ten minutes while it is in front, the published page is
 *  fetched fresh and its bundle name compared with the one running here. */
export function useNewerVersion(): boolean {
  const [newer, setNewer] = React.useState(false);
  React.useEffect(() => {
    const mine = runningBundle();
    if (!mine) return; // a development server, which has no bundle to compare
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`./index.html?check=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const published = (await res.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1];
        if (published && published !== mine) setNewer(true);
      } catch { /* offline, or between deploys: try again next time */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 10 * 60 * 1000);
    void check();
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
  }, []);
  return newer;
}
