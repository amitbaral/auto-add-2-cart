import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../../shopify.server";

type Rules = Array<{
  id: string;
  active: boolean;
  conditions: Array<
    | { type: "cart_quantity_at_least"; threshold: number }
    | { type: "cart_total_at_least"; amount: number; currencyCode?: string }
    | { type: "includes_any_variants"; variantIds: string[] }
    | { type: "includes_any_products"; productIds: string[] }
    | { type: "includes_any_collections"; collectionIds: string[] }
  >;
  action: { addVariantId: string; quantity?: number; titleOverride?: string };
}>;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, cors } = await authenticate.admin(request);
  const res = await admin.graphql(`#graphql
    query GetCollectionIndex { shop { metafield(namespace: "auto_add2cart", key: "collection_index") { value } } }
  `);
  const data = await res.json();
  const value: string | undefined = data?.data?.shop?.metafield?.value;
  let index: unknown = {};
  try { index = value ? JSON.parse(value) : {}; } catch { index = {}; }
  return cors(new Response(JSON.stringify({ index }), { headers: { "Content-Type": "application/json" } }));
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, cors } = await authenticate.admin(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }
  let body: any = {};
  try { body = await request.json(); } catch {
    body = {};
  }
  let collectionIds: string[] | undefined = Array.isArray(body?.collectionIds) ? body.collectionIds : undefined;

  if (!collectionIds) {
    // Fallback: read rules and collect collectionIds used in conditions
    const rulesRes = await admin.graphql(`#graphql
      query GetRulesMetafield { shop { metafield(namespace: "auto_add2cart", key: "rules") { value } } }
    `);
    const rulesData = await rulesRes.json();
    const rulesStr: string | undefined = rulesData?.data?.shop?.metafield?.value;
    let rules: Rules = [];
    try { rules = rulesStr ? JSON.parse(rulesStr) : []; } catch { rules = []; }
    const set = new Set<string>();
    for (const r of rules) {
      for (const c of r.conditions || []) {
        if ((c as any).type === "includes_any_collections" && Array.isArray((c as any).collectionIds)) {
          for (const cid of (c as any).collectionIds) set.add(cid);
        }
      }
    }
    collectionIds = Array.from(set);
  }

  if (!collectionIds || collectionIds.length === 0) {
    return cors(new Response(JSON.stringify({ ok: false, message: "No collections to index" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  // Build mapping: productId -> [collectionIds]
  const mapping = new Map<string, Set<string>>();
  for (const cid of collectionIds) {
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const q = `#graphql
        query ProductsInCollection($id: ID!, $cursor: String) {
          collection(id: $id) {
            products(first: 250, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id }
            }
          }
        }
      `;
      const resp = await admin.graphql(q, { variables: { id: cid, cursor } });
      const json = await resp.json();
      const conn = json?.data?.collection?.products;
      const nodes: Array<{ id: string }> = conn?.nodes || [];
      for (const n of nodes) {
        const set = mapping.get(n.id) || new Set<string>();
        set.add(cid);
        mapping.set(n.id, set);
      }
      hasNext = Boolean(conn?.pageInfo?.hasNextPage);
      cursor = conn?.pageInfo?.endCursor ?? null;
    }
  }

  // Merge with existing index
  const existingRes = await admin.graphql(`#graphql
    query GetCollectionIndex { shop { id metafield(namespace: "auto_add2cart", key: "collection_index") { value } } }
  `);
  const existingJson = await existingRes.json();
  const ownerId: string = existingJson?.data?.shop?.id;
  const existingStr: string | undefined = existingJson?.data?.shop?.metafield?.value;
  let existing: Record<string, string[]> = {};
  try { existing = existingStr ? JSON.parse(existingStr) : {}; } catch { existing = {}; }

  for (const [pid, set] of mapping.entries()) {
    const prev = new Set(existing[pid] || []);
    for (const c of set) prev.add(c);
    existing[pid] = Array.from(prev);
  }

  const mfRes = await admin.graphql(
    `#graphql
    mutation SetCollectionIndex($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [
        { ownerId: $ownerId, namespace: "auto_add2cart", key: "collection_index", type: "json", value: $value }
      ]) {
        userErrors { field message }
      }
    }
  `,
    { variables: { ownerId, value: JSON.stringify(existing) } }
  );
  const mfData = await mfRes.json();
  const errors = mfData?.data?.metafieldsSet?.userErrors;
  if (errors && errors.length) {
    return cors(new Response(JSON.stringify({ ok: false, errors }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }
  return cors(new Response(JSON.stringify({ ok: true, productsIndexed: Object.keys(existing).length }), { headers: { "Content-Type": "application/json" } }));
}
