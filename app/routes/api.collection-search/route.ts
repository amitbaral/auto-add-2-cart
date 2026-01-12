import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, cors } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) {
    return cors(new Response(JSON.stringify({ collections: [] }), { headers: { "Content-Type": "application/json" } }));
  }
  const gql = `#graphql
    query Collections($query: String!) {
      collections(first: 10, query: $query) {
        nodes { id title }
      }
    }
  `;
  const resp = await admin.graphql(gql, { variables: { query: q } });
  const json = await resp.json();
  const nodes = json?.data?.collections?.nodes || [];
  const collections = nodes.map((c: any) => ({ id: c.id, title: c.title }));
  return cors(new Response(JSON.stringify({ collections }), { headers: { "Content-Type": "application/json" } }));
}

// Preflight handler for stricter CORS environments
export async function action({ request }: { request: Request }) {
  const { cors } = await authenticate.admin(request as any);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }
  return cors(new Response(JSON.stringify({ ok: false, message: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json" } }));
}
