/**
 * Cloudflare Worker — CORS Proxy for PoE2 Trade API
 *
 * Deploy this as a Cloudflare Worker (free tier: 100k req/day).
 *
 * Steps:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Click "Create Worker"
 *   3. Paste this code and deploy
 *   4. Copy your worker URL (e.g. https://poe2-trade-proxy.<you>.workers.dev)
 *   5. Paste it into the "Trade Proxy URL" field in the calculator
 *
 * The worker only proxies POST requests to the PoE trade search API.
 */

const ALLOWED_ORIGIN_PATTERN = /^https?:\/\/(localhost(:\d+)?|denelduck\.github\.io)/;
const POE_TRADE_API = 'https://www.pathofexile.com/api/trade2/search/poe2/';

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, new Response(null, { status: 204 }));
    }

    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    // Extract league from the URL path: /search/{league}
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/search\/(.+)$/);
    if (!match) {
      return new Response('Invalid path. Use /search/{league}', { status: 400 });
    }

    const league = match[1]; // already URL-encoded from the client
    const targetUrl = POE_TRADE_API + league;

    try {
      const body = await request.text();

      // Validate that the body is valid JSON to prevent abuse
      JSON.parse(body);

      const poeResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PoE2TimelessJewelCalc/1.0 (https://denelduck.github.io/TimelessJewelCalculatorPOE2/)'
        },
        body
      });

      const responseBody = await poeResponse.text();
      const response = new Response(responseBody, {
        status: poeResponse.status,
        headers: { 'Content-Type': 'application/json' }
      });
      return handleCors(request, response);
    } catch (err) {
      return handleCors(request, new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  }
};

function handleCors(request, response) {
  const origin = request.headers.get('Origin') || '';
  const headers = new Headers(response.headers);

  if (ALLOWED_ORIGIN_PATTERN.test(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    headers
  });
}
