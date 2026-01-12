import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, cors } = await authenticate.admin(request);
  const res = await admin.graphql(`#graphql
    query GetRulesMetafield { shop { metafield(namespace: "auto_add2cart", key: "rules") { value } } }
  `);
  const data = await res.json();
  const value: string | undefined = data?.data?.shop?.metafield?.value;
  let rules: unknown = [];
  try { rules = value ? JSON.parse(value) : []; } catch { rules = []; }
  return cors(new Response(JSON.stringify({ rules }), { headers: { "Content-Type": "application/json" } }));
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, cors } = await authenticate.admin(request);
  if (request.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }
  const body = await request.json();
  const rulesStr = JSON.stringify(body?.rules ?? []);

  const shopRes = await admin.graphql(`#graphql
    query ShopId { shop { id } }
  `);
  const shopData = await shopRes.json();
  const ownerId: string = shopData?.data?.shop?.id;

  const mfRes = await admin.graphql(
    `#graphql
    mutation SetRulesMetafield($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [
        { ownerId: $ownerId, namespace: "auto_add2cart", key: "rules", type: "json", value: $value }
      ]) {
        userErrors { field message }
      }
    }
  `,
    { variables: { ownerId, value: rulesStr } }
  );
  const mfData = await mfRes.json();
  const errors = mfData?.data?.metafieldsSet?.userErrors;
  if (errors && errors.length) {
    return cors(new Response(JSON.stringify({ ok: false, errors }), { status: 400, headers: { "Content-Type": "application/json" } }));
  }
  return cors(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }));
}
