import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(`
    query GetRulesCount {
      shop {
        metafield(namespace: "auto_add2cart", key: "rules") { value }
      }
    }
  `);
  const data = await res.json();
  const rulesValue = data?.data?.shop?.metafield?.value;
  let rulesCount = 0;
  try {
    const rules = rulesValue ? JSON.parse(rulesValue) : [];
    rulesCount = Array.isArray(rules) ? rules.length : 0;
  } catch { }

  return { rulesCount };
};

export default function Index() {
  const { rulesCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Dashboard">
      <s-section heading="Welcome to Auto Add2Cart 🚀">
        <s-paragraph>
          Boost your store's average order value by automatically adding relevant products, gifts, or fees to customer carts.
        </s-paragraph>
      </s-section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '20px' }}>
        <s-card>
          <s-stack direction="block" gap="base" padding="base">
            <s-text type="strong">Active Rules</s-text>
            <s-text>{rulesCount} configured</s-text>
          </s-stack>
        </s-card>

        <s-card>
          <s-stack direction="block" gap="base" padding="base">
            <s-text type="strong">Conversions</s-text>
            <s-text color="subdued">Coming Soon</s-text>
          </s-stack>
        </s-card>

        <s-card>
          <s-stack direction="block" gap="base" padding="base">
            <s-text type="strong">ROI</s-text>
            <s-text color="subdued">Coming Soon</s-text>
          </s-stack>
        </s-card>
      </div>

      <s-section heading="Next Steps">
        <s-stack direction="block" gap="base">
          <s-card>
            <s-stack direction="inline" gap="base">
              <div style={{ flex: 1 }}>
                <s-text type="strong">Manage Your Rules</s-text>
                <s-paragraph>View, edit, or create new auto-add logic for your store.</s-paragraph>
              </div>
              <s-button variant="primary" onClick={() => { window.location.href = '/app/rules'; }}>Go to Rules</s-button>
            </s-stack>
          </s-card>

          <s-card>
            <s-stack direction="inline" gap="base">
              <div style={{ flex: 1 }}>
                <s-text type="strong">Troubleshooting & Logs</s-text>
                <s-paragraph>Check why a rule might not be triggering.</s-paragraph>
              </div>
              <s-button variant="secondary" disabled>View Logs</s-button>
            </s-stack>
          </s-card>
        </s-stack>
      </s-section>
    </s-page>
  );
}
