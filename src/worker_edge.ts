/**
 * Cloudflare Worker edge entry for `health-tracker-2`.
 *
 * The app is hosted on the VPS at https://health-tracking.duckdns.org. This
 * Worker is a no-build edge proxy: Cloudflare Workers Builds does not run a
 * front-end build (it ignores Custom Builds in the wrangler config), so the
 * previous `assets.directory: ./dist` config failed every deploy because `dist`
 * is not in the repo. Proxying keeps the Worker functional and the build green,
 * with no build step.
 */
const ORIGIN_HOST = 'health-tracking.duckdns.org';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.host = ORIGIN_HOST;
    return fetch(new Request(url.toString(), request));
  },
};
