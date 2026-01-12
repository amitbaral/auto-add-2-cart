import * as React from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useSearchParams } from "react-router";
import { authenticate } from "../../shopify.server";

type Condition =
  | { type: "cart_quantity_at_least"; threshold: number }
  | { type: "cart_quantity_in_range"; min: number; max?: number }
  | { type: "cart_total_at_least"; amount: number; currencyCode?: string }
  | { type: "includes_any_variants"; variantIds: string[] }
  | { type: "includes_any_products"; productIds: string[] }
  | { type: "includes_any_collections"; collectionIds: string[] }
  | { type: "product_quantity_in_range"; productId: string; min: number; max?: number };

type Rule = {
  id: string;
  active: boolean;
  group?: string;
  conditions: Condition[];
  action: { addVariantId: string; quantity?: number; titleOverride?: string };
};

type Rules = Rule[];

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  // Query both rules and active transforms
  const response = await admin.graphql(`
    query GetRulesAndStatus {
      shop {
        id
        metafield(namespace: "auto_add2cart", key: "rules") {
          value
        }
      }
      cartTransforms(first: 5) {
        nodes {
          id
          functionId
        }
      }
    }
  `);

  const { data } = await response.json();
  const rulesValue = data?.shop?.metafield?.value;
  let rules: Rules = [];
  try {
    rules = rulesValue ? JSON.parse(rulesValue) : [];
  } catch (e) {
    console.error("Failed to parse rules JSON", e);
  }

  const isTransformActive = data?.cartTransforms?.nodes?.length > 0;

  return {
    shopId: data?.shop?.id,
    rules,
    isTransformActive
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "activate") {
    console.log("Activating function...");
    // 1. Get Function ID using shopifyFunctions root query
    const appQuery = await admin.graphql(`
      query GetFunctionId {
        shopifyFunctions(first: 25) {
          nodes {
            id
            title
            apiType
          }
        }
      }
    `);
    const appData = await appQuery.json();
    console.log("App Functions:", JSON.stringify(appData?.data?.shopifyFunctions?.nodes));

    const func = appData?.data?.shopifyFunctions?.nodes?.find((f: any) =>
      f.title.includes("auto-add-2-cart") || f.apiType === "cart_transform"
    );

    if (!func) {
      return { ok: false, error: "Auto-add function not found. Please ensure the extension is deployed." };
    }

    console.log("Found function:", func.id);

    // 2. Create Cart Transform (without 'input' wrapper)
    const createRes = await admin.graphql(`
      mutation CreateTransform($functionId: String!) {
        cartTransformCreate(functionId: $functionId) {
          cartTransform {
            id
            functionId
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        functionId: func.id
      }
    });

    const createData = await createRes.json();
    console.log("Create Transform Result:", JSON.stringify(createData));

    if (createData?.data?.cartTransformCreate?.userErrors?.length > 0) {
      return { ok: false, errors: createData.data.cartTransformCreate.userErrors };
    }

    return { ok: true, message: "Function activated successfully!" };
  }

  const rulesStr = String(formData.get("rules") || "[]");

  // 1. Get Shop ID
  const shopResponse = await admin.graphql(`
    query GetShopId {
      shop {
        id
      }
    }
  `);
  const shopJson = await shopResponse.json();
  const ownerId = shopJson?.data?.shop?.id;

  if (!ownerId) {
    return { ok: false, error: "Missing Shop ID" };
  }

  // 2. Update Metafield
  const mutationResponse = await admin.graphql(`
    mutation SetRules($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [
        {
          ownerId: $ownerId,
          namespace: "auto_add2cart",
          key: "rules",
          type: "json",
          value: $value
        }
      ]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      ownerId,
      value: rulesStr
    }
  });

  const mutationJson = await mutationResponse.json();
  const userErrors = mutationJson?.data?.metafieldsSet?.userErrors;

  if (userErrors && userErrors.length > 0) {
    return { ok: false, errors: userErrors };
  }

  return new Response("", {
    status: 302,
    headers: { Location: "/app/rules?saved=1" }
  });
}

export default function RulesPage() {
  const { rules, isTransformActive } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showSaved, setShowSaved] = React.useState(false);

  // Show success message when redirected after save
  React.useEffect(() => {
    if (searchParams.get("saved") === "1") {
      setShowSaved(true);
      // Remove the query param from URL
      searchParams.delete("saved");
      setSearchParams(searchParams, { replace: true });
      // Auto-hide after 5 seconds
      const timer = setTimeout(() => setShowSaved(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams]);

  const example: Rules = [
    {
      id: "platform-fee-tier-1",
      active: true,
      group: "platform-fee",
      conditions: [{ type: "cart_quantity_in_range", min: 5, max: 9 }],
      action: { addVariantId: "gid://shopify/ProductVariant/YOUR_VARIANT_ID", quantity: 1 },
    },
  ];

  const handleSave = (r: Rules) => {
    const fd = new FormData();
    fd.append("rules", JSON.stringify(r));
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Auto-Add Rules">
      {showSaved && (
        <div style={{ marginBottom: '20px', backgroundColor: '#d4f5d4', padding: '12px 16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', color: '#1a7f37' }}>✓ Rules saved successfully!</span>
          <button onClick={() => setShowSaved(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>
      )}
      {!isTransformActive && (
        <div style={{ marginBottom: '20px' }}>
          <s-box padding="base" background="subdued" borderRadius="base">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <s-stack direction="block" gap="base">
                <s-text type="strong">Action Required: Enable Rules Function</s-text>
                <s-text>Your rules will not run on the storefront until the function is activated.</s-text>
              </s-stack>
              <s-button variant="primary" onClick={() => submit({ intent: "activate" }, { method: "post" })}>
                Activate Now
              </s-button>
            </div>
          </s-box>
        </div>
      )}

      {rules?.length > 0 && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => (document.getElementById('save-all-btn') as any)?.click()}
        >
          Save All Changes
        </s-button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: rules?.length > 0 ? '2fr 1fr' : '1fr', gap: '24px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <RuleBuilder
            initialRules={rules}
            onSave={handleSave}
          />
        </div>

        {rules?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <s-card>
              <s-stack direction="block" gap="base" padding="base">
                <s-text type="strong">Rules Guide</s-text>
                <s-stack direction="block" gap="base">
                  <s-text type="strong">Conditions</s-text>
                  <s-text color="subdued">Rules trigger only when ALL conditions are met.</s-text>
                </s-stack>
                <s-stack direction="block" gap="base">
                  <s-text type="strong">Exclusivity</s-text>
                  <s-text color="subdued">Use "Groups" to make rules exclusive. Only the first matching rule in a group runs.</s-text>
                </s-stack>
              </s-stack>
            </s-card>

            <s-card>
              <s-stack direction="block" gap="base" padding="base">
                <s-text type="strong">Collection Indexing</s-text>
                <s-paragraph>Functions cannot query collections in real-time. Index them here to use collection conditions.</s-paragraph>
                <s-text-field
                  label="Collection GIDs"
                  placeholder="gid://shopify/Collection/123"
                  id="col-idx-input"
                />
                <s-button tone="neutral" onClick={async () => {
                  const val = (document.getElementById('col-idx-input') as any)?.value;
                  const ids = val.trim() ? val.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                  try {
                    const res = await fetch('/api/collection-index', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: ids.length ? JSON.stringify({ collectionIds: ids }) : undefined
                    });
                    const json = await res.json();
                    alert(json.ok ? `Success! Indexed ${json.productsIndexed} products.` : 'Indexing failed.');
                  } catch {
                    alert('Network error.');
                  }
                }}>Rebuild Index</s-button>
              </s-stack>
            </s-card>
          </div>
        )}
      </div>
    </s-page>
  );
}

function RuleBuilder({ initialRules, onSave }: { initialRules: Rules; onSave: (rules: Rules) => void }) {
  const [rules, setRules] = React.useState<Rules>(initialRules);

  const addRule = () => {
    setRules([...rules, {
      id: `rule-${Date.now().toString().slice(-4)}`,
      active: true,
      conditions: [],
      action: { addVariantId: "", quantity: 1 }
    }]);
  };

  const updateRule = (idx: number, updatedRule: Rule) => {
    const copy = [...rules];
    copy[idx] = updatedRule;
    setRules(copy);
  };

  const removeRule = (idx: number) => {
    const copy = [...rules];
    copy.splice(idx, 1);
    setRules(copy);
  };

  if (rules.length === 0) {
    return (
      <s-box padding="base" background="subdued" borderRadius="base">
        <s-stack direction="block" align="center" gap="base">
          <s-text type="strong">Increase your AOV with auto-add rules</s-text>
          <s-paragraph>Automatically add free gifts, shipping insurance, or fees to the cart based on specific conditions.</s-paragraph>
          <s-button variant="primary" onClick={addRule}>Create Your First Rule</s-button>
        </s-stack>
      </s-box>
    );
  }

  const isValid = rules.every(r => r.id.trim() && r.action.addVariantId.trim());

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" align="space-between">
        <s-heading>Configure Rules</s-heading>
        <s-button variant="secondary" onClick={addRule}>Add Rule</s-button>
      </s-stack>

      {rules.map((r, idx) => (
        <RuleCard
          key={r.id}
          rule={r}
          onUpdate={(updated) => updateRule(idx, updated)}
          onRemove={() => removeRule(idx)}
        />
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
        <s-button id="save-all-btn" variant="primary" onClick={() => onSave(rules)} disabled={!isValid}>Save All Changes</s-button>
      </div>
    </s-stack>
  );
}

function RuleCard({ rule, onUpdate, onRemove }: { rule: Rule; onUpdate: (r: Rule) => void; onRemove: () => void }) {
  const [selectedCondType, setSelectedCondType] = React.useState<Condition["type"] | "">("");

  const addCondition = () => {
    if (!selectedCondType) return;

    let newCond: Condition;
    switch (selectedCondType) {
      case "cart_quantity_at_least": newCond = { type: selectedCondType, threshold: 1 }; break;
      case "cart_total_at_least": newCond = { type: selectedCondType, amount: 10 }; break;
      case "cart_quantity_in_range": newCond = { type: selectedCondType, min: 1, max: 10 }; break;
      case "includes_any_variants": newCond = { type: selectedCondType, variantIds: [] }; break;
      case "includes_any_products": newCond = { type: selectedCondType, productIds: [] }; break;
      case "includes_any_collections": newCond = { type: selectedCondType, collectionIds: [] }; break;
      case "product_quantity_in_range": newCond = { type: selectedCondType, productId: "", min: 1 }; break;
      default: return;
    }

    onUpdate({
      ...rule,
      conditions: [...rule.conditions, newCond]
    });
    setSelectedCondType("");
  };

  const updateCondition = (cIdx: number, updatedCond: Condition) => {
    const nextConditions = [...rule.conditions];
    nextConditions[cIdx] = updatedCond;
    onUpdate({ ...rule, conditions: nextConditions });
  };

  const removeCondition = (cIdx: number) => {
    const nextConditions = [...rule.conditions];
    nextConditions.splice(cIdx, 1);
    onUpdate({ ...rule, conditions: nextConditions });
  };

  return (
    <s-card>
      <s-stack direction="block" gap="base" padding="base">
        <s-stack direction="inline" gap="base" align="space-between" blockAlign="center">
          <s-stack direction="inline" gap="base" blockAlign="center">
            <s-heading>{rule.id || "Untitled Rule"}</s-heading>
            {rule.group && <s-badge tone="info">{rule.group}</s-badge>}
          </s-stack>
          <s-stack direction="inline" gap="base" blockAlign="center">
            <s-toggle
              label="Active"
              checked={rule.active}
              onChange={(e: any) => onUpdate({ ...rule, active: e.target.checked })}
            />
            <s-button tone="critical" variant="tertiary" onClick={onRemove}>
              Delete
            </s-button>
          </s-stack>
        </s-stack>

        <div style={{ height: "1px", background: "var(--s-border-subdued, #e1e3e5)", margin: "4px 0" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <s-text-field
            label="Rule ID"
            value={rule.id}
            onInput={(e: any) => onUpdate({ ...rule, id: e.target.value })}
            autocomplete="off"
          />
          <s-text-field
            label="Group (Exclusivity)"
            placeholder="e.g. tier-rewards"
            value={rule.group || ""}
            onInput={(e: any) => onUpdate({ ...rule, group: e.target.value })}
            autocomplete="off"
          />
        </div>

        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack direction="block" gap="base">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <s-text type="strong">Conditions</s-text>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <select
                  value={selectedCondType}
                  onChange={(e: any) => setSelectedCondType(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid #c9cccf",
                    backgroundColor: "white",
                    fontSize: "14px",
                    cursor: "pointer",
                    minWidth: "180px",
                    height: "36px"
                  }}
                >
                  <option value="">+ Add condition...</option>
                  <option value="cart_quantity_at_least">Items Count ≥</option>
                  <option value="cart_quantity_in_range">Items Count Range</option>
                  <option value="cart_total_at_least">Cart Total ≥</option>
                  <option value="includes_any_variants">Includes Variants</option>
                  <option value="includes_any_products">Includes Products</option>
                  <option value="includes_any_collections">Includes Collections</option>
                  <option value="product_quantity_in_range">Specific Product Range</option>
                </select>
                <s-button onClick={addCondition} disabled={!selectedCondType} variant="secondary">
                  Add
                </s-button>
              </div>
            </div>

            {rule.conditions.length === 0 && <s-text color="subdued">This rule applies to all carts.</s-text>}

            {rule.conditions.map((c, cIdx) => (
              <s-box key={cIdx} padding="base" background="subdued" borderRadius="base" borderWidth="base">
                <s-stack direction="inline" gap="base">
                  <div style={{ flex: 1 }}>
                    <s-badge tone="neutral">{c.type.split('_').join(' ').toUpperCase()}</s-badge>
                    <div style={{ marginTop: '8px' }}>
                      {c.type === "cart_quantity_at_least" && <s-number-field label="Min items" value={String(c.threshold)} onInput={(e: any) => updateCondition(cIdx, { ...c, threshold: Number(e.target.value) })} />}
                      {c.type === "cart_quantity_in_range" && <s-stack direction="inline" gap="base">
                        <s-number-field label="Min" value={String(c.min)} onInput={(e: any) => updateCondition(cIdx, { ...c, min: Number(e.target.value) })} />
                        <s-number-field label="Max" value={String(c.max ?? "")} onInput={(e: any) => updateCondition(cIdx, { ...c, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      </s-stack>}
                      {c.type === "cart_total_at_least" && <s-stack direction="inline" gap="base">
                        <s-number-field label="Amount" value={String(c.amount)} onInput={(e: any) => updateCondition(cIdx, { ...c, amount: Number(e.target.value) })} />
                        <s-text-field label="Currency" value={c.currencyCode || ""} onInput={(e: any) => updateCondition(cIdx, { ...c, currencyCode: e.target.value })} placeholder="USD" />
                      </s-stack>}
                      {["includes_any_variants", "includes_any_products", "includes_any_collections"].includes(c.type) && (
                        <s-stack direction="block" gap="base">
                          <s-text-field
                            placeholder="GID1, GID2..."
                            value={((c as any).variantIds || (c as any).productIds || (c as any).collectionIds || []).join(',')}
                            onInput={(e: any) => {
                              const val = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                              if (c.type === "includes_any_variants") updateCondition(cIdx, { ...c, variantIds: val });
                              else if (c.type === "includes_any_products") updateCondition(cIdx, { ...c, productIds: val });
                              else if (c.type === "includes_any_collections") updateCondition(cIdx, { ...c, collectionIds: val });
                            }}
                          />
                          {c.type === "includes_any_variants" && <VariantPicker onPick={(vid) => { const s = new Set(c.variantIds); s.add(vid); updateCondition(cIdx, { ...c, variantIds: Array.from(s) }); }} />}
                          {c.type === "includes_any_products" && <ProductPicker onPick={(pid) => { const s = new Set(c.productIds); s.add(pid); updateCondition(cIdx, { ...c, productIds: Array.from(s) }); }} />}
                          {c.type === "includes_any_collections" && <CollectionPicker onPick={(cid) => { const s = new Set(c.collectionIds); s.add(cid); updateCondition(cIdx, { ...c, collectionIds: Array.from(s) }); }} />}
                        </s-stack>
                      )}
                      {c.type === "product_quantity_in_range" && (
                        <s-stack direction="block" gap="base">
                          <s-text-field label="Product ID" value={c.productId} onInput={(e: any) => updateCondition(cIdx, { ...c, productId: e.target.value })} />
                          <ProductPicker onPick={(pid) => updateCondition(cIdx, { ...c, productId: pid })} />
                          <s-stack direction="inline" gap="base">
                            <s-number-field label="Min" value={String(c.min)} onInput={(e: any) => updateCondition(cIdx, { ...c, min: Number(e.target.value) })} />
                            <s-number-field label="Max" value={String(c.max ?? "")} onInput={(e: any) => updateCondition(cIdx, { ...c, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                          </s-stack>
                        </s-stack>
                      )}
                    </div>
                  </div>
                  <s-button tone="critical" variant="tertiary" onClick={() => removeCondition(cIdx)}>×</s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-box>

        <s-stack direction="block" gap="base">
          <s-text type="strong">Action: Add to Cart</s-text>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px", alignItems: "end" }}>
            <s-text-field
              label="Variant ID"
              value={rule.action.addVariantId}
              onInput={(e: any) => onUpdate({ ...rule, action: { ...rule.action, addVariantId: e.target.value } })}
              autocomplete="off"
            />
            <s-number-field
              label="Quantity"
              value={String(rule.action.quantity || 1)}
              onInput={(e: any) => onUpdate({ ...rule, action: { ...rule.action, quantity: Number(e.target.value) } })}
              min={1}
            />
          </div>
          <div style={{ marginTop: "4px" }}>
            <VariantPicker
              value={rule.action.addVariantId}
              onPick={(vid, label) =>
                onUpdate({ ...rule, action: { ...rule.action, addVariantId: vid, titleOverride: label } })
              }
            />
          </div>
        </s-stack>
      </s-stack>
    </s-card>
  );
}

function VariantPicker({ value, onPick }: { value?: string; onPick: (id: string, label: string) => void }) {
  const [term, setTerm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<any[]>([]);
  const [open, setOpen] = React.useState(false);

  const search = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/product-search?q=${encodeURIComponent(term)}`);
      const json = await res.json();
      setResults(json.products || []);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return (
    <div style={{ marginTop: '8px' }}>
      <s-button variant="tertiary" onClick={() => setOpen(true)}>
        Find Variant...
      </s-button>
    </div>
  );

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          <div style={{ flex: 1 }}><s-text-field placeholder="Search Snowboard..." value={term} onInput={(e: any) => setTerm(e.target.value)} /></div>
          <s-button onClick={search} loading={loading}>Search</s-button>
          <s-button variant="tertiary" onClick={() => setOpen(false)}>Close</s-button>
        </s-stack>
        <s-stack direction="block" gap="base">
          {results.map(p => (
            <div key={p.id}>
              <s-text type="strong">{p.title}</s-text>
              <s-stack direction="inline" gap="base" style={{ marginTop: '4px' }}>
                {p.variants.map((v: any) => (
                  <s-button key={v.id} variant={value === v.id ? "secondary" : "tertiary"} onClick={() => { onPick(v.id, `${p.title} - ${v.title}`); setOpen(false); }}>
                    {v.title}
                  </s-button>
                ))}
              </s-stack>
            </div>
          ))}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function ProductPicker({ onPick }: { onPick: (id: string) => void }) {
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<any[]>([]);
  const search = async () => {
    const res = await fetch(`/api/product-search?q=${encodeURIComponent(term)}`);
    const json = await res.json();
    setResults(json.products || []);
  };
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" >
        <div style={{ flex: 1 }}><s-text-field value={term} onInput={(e: any) => setTerm(e.target.value)} /></div>
        <s-button onClick={search}>Search</s-button>
      </s-stack>
      <s-stack direction="inline" gap="base">{results.map(p => <s-button key={p.id} variant="tertiary" onClick={() => onPick(p.id)}>{p.title}</s-button>)}</s-stack>
    </s-stack>
  );
}

function CollectionPicker({ onPick }: { onPick: (id: string) => void }) {
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<any[]>([]);
  const search = async () => {
    const res = await fetch(`/api/collection-search?q=${encodeURIComponent(term)}`);
    const json = await res.json();
    setResults(json.collections || []);
  };
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" >
        <div style={{ flex: 1 }}><s-text-field value={term} onInput={(e: any) => setTerm(e.target.value)} /></div>
        <s-button onClick={search}>Search</s-button>
      </s-stack>
      <s-stack direction="inline" gap="base">{results.map(c => <s-button key={c.id} variant="tertiary" onClick={() => onPick(c.id)}>{c.title}</s-button>)}</s-stack>
    </s-stack>
  );
}