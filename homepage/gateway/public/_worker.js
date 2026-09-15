// Cloudflare Pages supplies external-DNS custom-domain support. All application
// behavior stays in the bound Worker; no snapshots or credentials live here.
export default {
  async fetch(request, env) {
    const unavailable = (status) =>
      new Response(
        status === 421
          ? "Unknown homepage host"
          : "Homepage temporarily unavailable",
        {
          status,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex, nofollow",
            "x-content-type-options": "nosniff",
          },
        },
      );
    // Reject Pages deployment aliases before forwarding any request or cookie.
    if (new URL(request.url).origin !== env.HOME_ORIGIN)
      return unavailable(421);
    try {
      return await env.HOMEPAGE.fetch(request);
    } catch {
      return unavailable(503);
    }
  },
};
