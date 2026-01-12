import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Helper function to add CORS headers to response
function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

/**
 * Public API endpoint for storefront to fetch rules
 * This endpoint uses App Proxy authentication (no admin auth required)
 */
export async function loader({ request }: LoaderFunctionArgs) {
    // Handle preflight OPTIONS request
    if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
    }

    // Get shop from query params (set by App Proxy)
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        return withCors(new Response(JSON.stringify({ error: "Missing shop parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        }));
    }

    try {
        // Use offline session to get admin access
        const { admin } = await authenticate.public.appProxy(request);

        if (!admin) {
            return withCors(new Response(JSON.stringify({ error: "Authentication failed", rules: [] }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            }));
        }

        const response = await admin.graphql(`
      query GetRules {
        shop {
          metafield(namespace: "auto_add2cart", key: "rules") {
            value
          }
        }
      }
    `);

        const { data } = await response.json();
        const rulesValue = data?.shop?.metafield?.value;
        let rules = [];

        try {
            rules = rulesValue ? JSON.parse(rulesValue) : [];
        } catch (e) {
            console.error("Failed to parse rules JSON", e);
        }

        // Only return active rules
        const activeRules = rules.filter((r: any) => r && r.active);

        return withCors(new Response(JSON.stringify({ rules: activeRules }), {
            headers: { "Content-Type": "application/json" }
        }));
    } catch (error) {
        console.error("Error fetching rules:", error);
        return withCors(new Response(JSON.stringify({ error: "Failed to fetch rules", rules: [] }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        }));
    }
}
