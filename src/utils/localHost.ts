// Is the page served from this machine? Besides localhost / 127.0.0.1 / [::1], the local virtual hosts
// (recta.localhost, recta.local, ...) count: analytics, Sentry and the production service worker stay off there.
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.local');
}
