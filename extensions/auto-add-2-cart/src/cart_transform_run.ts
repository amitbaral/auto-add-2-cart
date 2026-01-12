import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = { operations: [] };

type CurrencyCode = CartTransformRunInput["cart"]["lines"][number]["cost"]["totalAmount"]["currencyCode"]; // reuse type

type RuleCondition =
  | {
    type: "cart_quantity_at_least";
    threshold: number;
  }
  | {
    type: "cart_total_at_least";
    amount: number;
    currencyCode?: CurrencyCode;
  }
  | {
    type: "includes_any_variants";
    variantIds: string[]; // GIDs for ProductVariant
  }
  | {
    type: "cart_quantity_in_range";
    min: number;
    max?: number; // inclusive, if omitted no upper bound
  }
  | {
    type: "includes_any_products";
    productIds: string[]; // GIDs for Product
  }
  | {
    type: "includes_any_collections";
    collectionIds: string[]; // GIDs for Collection
  }
  | {
    type: "product_quantity_in_range";
    productId: string; // GID for Product
    min: number;
    max?: number;
  };

type RuleAction = {
  addVariantId: string; // GID for ProductVariant to include as component
  quantity?: number; // default 1
  titleOverride?: string; // optional
};

type AutoAddRule = {
  id: string;
  active: boolean;
  group?: string; // optional exclusivity group
  conditions: RuleCondition[];
  action: RuleAction;
};

function parseRules(input: CartTransformRunInput): AutoAddRule[] {
  const raw = input.shop?.rules?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

function parseCollectionIndex(input: CartTransformRunInput): Map<string, Set<string>> {
  // Returns a map of productId -> set of collectionIds
  const raw = input.shop?.collectionIndex?.value;
  const map = new Map<string, Set<string>>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw);
    // Support either { productId: [collectionIds] } or { productId: { collections: [ids] } }
    if (parsed && typeof parsed === "object") {
      for (const [productId, v] of Object.entries(parsed as Record<string, unknown>)) {
        let list: string[] = [];
        if (Array.isArray(v)) {
          list = (v as unknown[]).filter((x): x is string => typeof x === "string");
        } else if (v && typeof v === "object") {
          const obj = v as { collections?: unknown };
          if (Array.isArray(obj.collections)) {
            list = obj.collections.filter((x): x is string => typeof x === "string");
          }
        }
        if (list.length) map.set(productId, new Set(list));
      }
    }
  } catch (_e) {
    return map;
  }
  return map;
}

function cartQuantity(input: CartTransformRunInput): number {
  return input.cart.lines.reduce((sum, l) => sum + l.quantity, 0);
}

function cartTotalAmount(input: CartTransformRunInput): { amount: number; currency: CurrencyCode | null } {
  // Sum line totals (presentment currency)
  let amount = 0;
  let currency: CurrencyCode | null = null;
  for (const line of input.cart.lines) {
    const a = parseFloat(line.cost.totalAmount.amount);
    amount += isNaN(a) ? 0 : a;
    currency = currency ?? line.cost.totalAmount.currencyCode;
  }
  return { amount, currency };
}

function includesAnyVariant(input: CartTransformRunInput, variantIds: string[]): boolean {
  const set = new Set(variantIds);
  for (const line of input.cart.lines) {
    const merch = line.merchandise as { __typename?: string; id?: string };
    if (merch && merch.__typename === "ProductVariant" && merch.id && set.has(merch.id)) {
      return true;
    }
  }
  return false;
}

function variantInCart(input: CartTransformRunInput, variantId: string): boolean {
  for (const line of input.cart.lines) {
    const merch = line.merchandise as { __typename?: string; id?: string };
    if (merch && merch.__typename === "ProductVariant" && merch.id === variantId) return true;
  }
  return false;
}

function ruleApplies(rule: AutoAddRule, input: CartTransformRunInput): boolean {
  if (!rule.active) {
    console.error(`Rule ${rule.id} skipped: not active`);
    return false;
  }
  for (const cond of rule.conditions) {
    switch (cond.type) {
      case "cart_quantity_at_least": {
        const q = cartQuantity(input);
        if (q < cond.threshold) {
          console.error(`Rule ${rule.id} condition failed: cart quantity ${q} < ${cond.threshold}`);
          return false;
        }
        break;
      }
      case "cart_total_at_least": {
        const { amount, currency } = cartTotalAmount(input);
        if (amount < cond.amount) {
          console.error(`Rule ${rule.id} condition failed: cart total ${amount} < ${cond.amount}`);
          return false;
        }
        if (cond.currencyCode && currency && cond.currencyCode !== currency) {
          console.error(`Rule ${rule.id} condition failed: currency mismatch ${currency} vs ${cond.currencyCode}`);
          return false;
        }
        break;
      }
      case "includes_any_variants": {
        if (!includesAnyVariant(input, cond.variantIds)) {
          console.error(`Rule ${rule.id} condition failed: variants not in cart`);
          return false;
        }
        break;
      }
      case "includes_any_products": {
        const set = new Set(cond.productIds);
        let found = false;
        for (const line of input.cart.lines) {
          const merch = line.merchandise as { __typename?: string; product?: { id?: string } };
          if (merch && merch.__typename === "ProductVariant" && merch.product?.id && set.has(merch.product.id)) {
            found = true;
            break;
          }
        }
        if (!found) {
          console.error(`Rule ${rule.id} condition failed: none of products ${cond.productIds} in cart`);
          return false;
        }
        break;
      }
      case "includes_any_collections": {
        const idx = parseCollectionIndex(input);
        const target = new Set(cond.collectionIds);
        let found = false;
        for (const line of input.cart.lines) {
          const merch = line.merchandise as { __typename?: string; product?: { id?: string } };
          const pid = merch && merch.__typename === "ProductVariant" ? merch.product?.id : undefined;
          if (!pid) continue;
          const colls = idx.get(pid);
          if (!colls) continue;
          for (const c of colls) {
            if (target.has(c)) { found = true; break; }
          }
          if (found) break;
        }
        if (!found) {
          console.error(`Rule ${rule.id} condition failed: collections not matched`);
          return false;
        }
        break;
      }
      case "cart_quantity_in_range": {
        const q = cartQuantity(input);
        if (q < cond.min) {
          console.error(`Rule ${rule.id} condition failed: quantity ${q} < min ${cond.min}`);
          return false;
        }
        if (typeof cond.max === "number" && q > cond.max) {
          console.error(`Rule ${rule.id} condition failed: quantity ${q} > max ${cond.max}`);
          return false;
        }
        break;
      }
      case "product_quantity_in_range": {
        let total = 0;
        const targetPid = cond.productId.trim();
        for (const line of input.cart.lines) {
          const merch = line.merchandise as { __typename?: string; product?: { id?: string } };
          const pid = merch && merch.__typename === "ProductVariant" ? merch.product?.id?.trim() : undefined;
          if (pid) {
            console.error(`Comparing cart pid [${pid}] with target [${targetPid}]`);
          }
          if (pid === targetPid) total += line.quantity;
        }
        if (total < cond.min) {
          console.error(`Rule ${rule.id} condition failed: product ${targetPid} quantity ${total} < min ${cond.min}`);
          return false;
        }
        if (typeof cond.max === "number" && total > cond.max) {
          console.error(`Rule ${rule.id} condition failed: product ${targetPid} quantity ${total} > max ${cond.max}`);
          return false;
        }
        break;
      }
      default:
        console.error(`Rule ${rule.id} failed: unknown condition type`);
        return false;
    }
  }
  return true;
}

function pickAnchorLineId(input: CartTransformRunInput): string | null {
  // Prefer the first ProductVariant line
  for (const line of input.cart.lines) {
    const merch = line.merchandise as { __typename?: string; id?: string };
    if (merch && merch.__typename === "ProductVariant") return line.id;
  }
  // Fallback to any line
  return input.cart.lines[0]?.id ?? null;
}

export function cartTransformRun(input: CartTransformRunInput): CartTransformRunResult {
  // Cart Transform is disabled - all gift logic is handled by theme extension JavaScript
  // This prevents conflicts between Cart Transform and the storefront JavaScript
  console.error("CartTransform Function: Passing through (gift logic handled by theme JS)");
  return NO_CHANGES;
}