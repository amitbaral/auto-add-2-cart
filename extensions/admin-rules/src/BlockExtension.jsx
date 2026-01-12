/* eslint-disable react/prop-types */
import {render} from 'preact';
import {useState, useEffect, useRef} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  const { extension: {target} } = shopify;
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState('');
  const textRef = useRef(null);
  const [mode, setMode] = useState('json'); // 'json' | 'builder'
  const [prodTerm, setProdTerm] = useState('');
  const [collTerm, setCollTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [productResults, setProductResults] = useState([]); // [{id,title,variants:[{id,title}]}]
  const [collectionResults, setCollectionResults] = useState([]); // [{id,title}]
  const [indexCollections, setIndexCollections] = useState(''); // comma-separated collection GIDs for index rebuild
  const [validationErrors, setValidationErrors] = useState([]);

  const s = /** @type {any} */ (shopify);

  async function loadRules() {
    setLoading(true); setError('');
    try {
      const res = await (s.fetch ? s.fetch('/api/rules') : fetch('/api/rules'));
      const json = await res.json();
      const next = json.rules || [];
      setRules(next);
      setValidationErrors(validateAll(next));
    } catch (e) {
      setError('Failed to load rules');
    } finally { setLoading(false); }
  }

  async function saveRules() {
    setLoading(true); setError('');
    try {
      // Read current JSON from textarea
      const el = textRef.current;
      let next = rules;
      try { next = el && el.value ? JSON.parse(el.value) : rules; } catch (err) { /* keep last rules if invalid */ }
      const res = await (s.fetch ? s.fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: next }) }) : fetch('/api/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: next }) }));
      const json = await res.json();
      if (!json.ok) throw new Error('Save failed');
      setRules(next);
      setValidationErrors(validateAll(next));
    } catch (e) {
      setError('Failed to save rules');
    } finally { setLoading(false); }
  }

  async function searchProducts() {
    setSearching(true); setError('');
    try {
      const res = await (s.fetch ? s.fetch(`/api/product-search?q=${encodeURIComponent(prodTerm)}`) : fetch(`/api/product-search?q=${encodeURIComponent(prodTerm)}`));
      const json = await res.json();
      setProductResults(Array.isArray(json.products) ? json.products : []);
    } catch (e) {
      setError('Product search failed');
    } finally { setSearching(false); }
  }

  async function fetchProducts(term) {
    try {
      const res = await (s.fetch ? s.fetch(`/api/product-search?q=${encodeURIComponent(term)}`) : fetch(`/api/product-search?q=${encodeURIComponent(term)}`));
      const json = await res.json();
      return Array.isArray(json.products) ? json.products : [];
    } catch {
      return [];
    }
  }

  async function searchCollections() {
    setSearching(true); setError('');
    try {
      const res = await (s.fetch ? s.fetch(`/api/collection-search?q=${encodeURIComponent(collTerm)}`) : fetch(`/api/collection-search?q=${encodeURIComponent(collTerm)}`));
      const json = await res.json();
      setCollectionResults(Array.isArray(json.collections) ? json.collections : []);
    } catch (e) {
      setError('Collection search failed');
    } finally { setSearching(false); }
  }

  async function fetchCollections(term) {
    try {
      const res = await (s.fetch ? s.fetch(`/api/collection-search?q=${encodeURIComponent(term)}`) : fetch(`/api/collection-search?q=${encodeURIComponent(term)}`));
      const json = await res.json();
      return Array.isArray(json.collections) ? json.collections : [];
    } catch {
      return [];
    }
  }

  function insertTextAtCursor(text) {
    const el = textRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    el.focus();
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (err) { /* noop */ }
  }

  function validateRule(r) {
    const errs = [];
    if (!r || typeof r !== 'object') { errs.push('Invalid rule'); return errs; }
    if (!r.id || !String(r.id).trim()) errs.push('Missing rule id');
    if (!r.action || !r.action.addVariantId || !String(r.action.addVariantId).trim()) errs.push('Missing action.addVariantId');
    if (Array.isArray(r.conditions)) {
      r.conditions.forEach((c, i) => {
        if (!c || !c.type) { errs.push(`Condition #${i+1}: missing type`); return; }
        if (c.type === 'cart_quantity_at_least' && (typeof c.threshold !== 'number' || c.threshold < 0)) errs.push('cart_quantity_at_least: threshold must be >= 0');
        if (c.type === 'cart_quantity_in_range') {
          if (typeof c.min !== 'number' || c.min < 0) errs.push('cart_quantity_in_range: min must be >= 0');
          if (c.max != null && (typeof c.max !== 'number' || c.max < c.min)) errs.push('cart_quantity_in_range: max must be >= min');
        }
        if (c.type === 'cart_total_at_least' && (typeof c.amount !== 'number' || c.amount < 0)) errs.push('cart_total_at_least: amount must be >= 0');
        if (c.type === 'includes_any_variants' && (!Array.isArray(c.variantIds) || c.variantIds.length === 0)) errs.push('includes_any_variants: add at least one variant');
        if (c.type === 'includes_any_products' && (!Array.isArray(c.productIds) || c.productIds.length === 0)) errs.push('includes_any_products: add at least one product');
        if (c.type === 'includes_any_collections' && (!Array.isArray(c.collectionIds) || c.collectionIds.length === 0)) errs.push('includes_any_collections: add at least one collection');
        if (c.type === 'product_quantity_in_range') {
          if (!c.productId || !String(c.productId).trim()) errs.push('product_quantity_in_range: productId required');
          if (typeof c.min !== 'number' || c.min < 0) errs.push('product_quantity_in_range: min must be >= 0');
          if (c.max != null && (typeof c.max !== 'number' || c.max < c.min)) errs.push('product_quantity_in_range: max must be >= min');
        }
      });
    }
    return errs;
  }

  function validateAll(rulesArr) {
    const allErrs = [];
    (rulesArr || []).forEach((r, idx) => {
      const errs = validateRule(r);
      if (errs.length) allErrs.push({ idx, id: r?.id ?? idx, errors: errs });
    });
    return allErrs;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRules(); }, []);

  return (
    <s-admin-block heading="Auto-Add Rules">
      <s-stack direction="block">
        <s-text type="strong">Auto Add2Cart Admin Block — {target}</s-text>
        {error && <s-banner tone="critical">{error}</s-banner>}
        {loading ? (
          <s-text>Loading…</s-text>
        ) : (
          <>
            <s-stack direction="inline">
              <s-button tone="neutral" onClick={() => setMode('json')}>JSON</s-button>
              <s-button tone="neutral" onClick={() => {
                // Try parse JSON into rules when switching
                try {
                  const el = textRef.current;
                  const parsed = el && el.value ? JSON.parse(el.value) : rules;
                  if (Array.isArray(parsed)) setRules(parsed);
                } catch (err) { /* ignore parse error and keep current rules */ }
                setMode('builder');
              }}>Visual Builder</s-button>
              <s-button onClick={loadRules}>Refresh</s-button>
              <s-button tone="neutral" onClick={saveRules} disabled={validationErrors.length > 0}>Save</s-button>
            </s-stack>

            {mode === 'json' && (
              <>
                <s-text-area ref={textRef} value={JSON.stringify(rules, null, 2)} />
                <QuickPickers prodTerm={prodTerm} setProdTerm={setProdTerm} collTerm={collTerm} setCollTerm={setCollTerm}
                  searching={searching} searchProducts={searchProducts} searchCollections={searchCollections}
                  productResults={productResults} collectionResults={collectionResults} insertTextAtCursor={insertTextAtCursor} />
                {validationErrors.length > 0 && (
                  <s-banner tone="critical">{validationErrors.length} rule(s) have issues. Switch to Visual Builder to resolve.</s-banner>
                )}
              </>
            )}
            {mode === 'builder' && (
              <RuleBuilder rules={rules} setRules={setRules}
                searchProducts={searchProducts} productResults={productResults}
                fetchProducts={fetchProducts} fetchCollections={fetchCollections}
                searching={searching} onValidate={(all) => setValidationErrors(all)} validateAll={validateAll} validateRule={validateRule}
              />
            )}

            <s-divider />
            <s-text type="strong">Collection Index</s-text>
            <s-text>Rebuild the collection index used by collection-based rules.</s-text>
            <s-stack direction="inline">
              <s-text-field label="Collection GIDs (comma-separated)" value={indexCollections} onInput={(e) => setIndexCollections((/** @type {any} */(e.target)).value)} />
              <s-button onClick={async () => {
                setLoading(true); setError('');
                try {
                  const ids = indexCollections.split(',').map(s=>s.trim()).filter(Boolean);
                  const res = await (s.fetch ? s.fetch('/api/collection-index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionIds: ids }) }) : fetch('/api/collection-index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collectionIds: ids }) }));
                  const j = await res.json();
                  if (!j.ok) throw new Error(j.message || 'Index failed');
                } catch (e) {
                  setError('Index rebuild failed');
                } finally { setLoading(false); }
              }}>Rebuild</s-button>
            </s-stack>

            <s-divider />
            <s-text type="strong">How it works</s-text>
            <s-text>
              Create a rule, add one or more conditions, set the action (variant and quantity), then Save. Use search pickers to avoid mistakes when selecting products, variants, or collections.
              For collection-based rules, make sure the collection index is built so the Function can evaluate them quickly.
            </s-text>

          </>
        )}
      </s-stack>
    </s-admin-block>
  );
}

function CollectionsDropdown({ selected, onChange, fetchCollections }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);

  async function update(term0) {
    setTerm(term0);
    if (!term0.trim()) { setOptions([]); setOpen(false); return; }
    const opts = await fetchCollections(term0);
    setOptions(opts || []);
    setOpen(true);
  }

  function toggle(id) {
    const set = new Set(selected || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange(Array.from(set));
  }

  return (
    <div style={{ width: '100%', maxWidth: 560 }}>
      <s-text type="strong" style={{ fontSize: 16, color: '#334155', marginBottom: 4 }}>📚 Collections</s-text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px 0' }}>
        {(selected||[]).map(id => (
          <span key={id} style={{ background: '#e0e7ef', color: '#334155', borderRadius: 14, padding: '5px 14px', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{id}</span>
            <button type="button" style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 15, cursor: 'pointer', marginLeft: 2 }} onClick={() => toggle(id)} title="Remove">✕</button>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <s-text-field label="Search collections" value={term}
          onInput={async (e) => { await update((/** @type {any} */(e.target)).value); }}
          onFocus={() => setOpen(options.length > 0)} style={{ fontSize: 15 }} />
        {open && options.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e1e3e5', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.10)', maxHeight: 260, overflowY: 'auto', zIndex: 10 }}>
            {options.map(opt => (
              <button type="button" key={opt.id} style={{ padding: '10px 14px', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex', justifyContent: 'space-between', fontSize: 15, borderBottom: '1px solid #f1f5f9' }} onClick={() => toggle(opt.id)}>
                <span>{opt.title}</span>
                <span>{(selected||[]).includes(opt.id) ? '✓' : '+'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickPickers({ prodTerm, setProdTerm, collTerm, setCollTerm, searching, searchProducts, searchCollections, productResults, collectionResults, insertTextAtCursor }) {
  return (
    <>
      <s-divider />
      <s-text type="strong" style={{ fontSize: 16, color: '#334155', margin: '18px 0 8px 0' }}>Quick Pickers</s-text>
      <s-stack direction="block" style={{ marginBottom: 18 }}>
        <s-text style={{ marginBottom: 8 }}>Insert GIDs into the JSON by clicking results.</s-text>
        <s-stack direction="inline" style={{ marginBottom: 10 }}>
          <s-text-field label="Search products" value={prodTerm} onInput={(e) => setProdTerm((/** @type {any} */(e.target)).value)} style={{ fontSize: 15 }} />
          <s-button onClick={searchProducts} disabled={!prodTerm.trim() || searching}>Search</s-button>
        </s-stack>
        {productResults.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {productResults.map((p) => (
              <div key={p.id} style={{ marginBottom: 8 }}>
                <s-text type="strong">{p.title}</s-text>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {(p.variants || []).map((v) => (
                    <s-button key={v.id} onClick={() => insertTextAtCursor(v.id)}>{v.title}</s-button>
                  ))}
                  <s-button tone="neutral" onClick={() => insertTextAtCursor(p.id)}>Use Product ID</s-button>
                </div>
              </div>
            ))}
          </div>
        )}

        <s-stack direction="inline" style={{ marginBottom: 10 }}>
          <s-text-field label="Search collections" value={collTerm} onInput={(e) => setCollTerm((/** @type {any} */(e.target)).value)} style={{ fontSize: 15 }} />
          <s-button onClick={searchCollections} disabled={!collTerm.trim() || searching}>Search</s-button>
        </s-stack>
        {collectionResults.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {collectionResults.map((c) => (
              <s-button key={c.id} onClick={() => insertTextAtCursor(c.id)}>{c.title}</s-button>
            ))}
          </div>
        )}
      </s-stack>
    </>
  );
}

function RuleBuilder({ rules, setRules, searchProducts, productResults, fetchProducts, fetchCollections, searching, onValidate, validateAll, validateRule }) {
  const [selectedCond, setSelectedCond] = useState('');
  const [variantTerm, setVariantTerm] = useState('');
  const [variantOpen, setVariantOpen] = useState(false);
  const [variantOptions, setVariantOptions] = useState([]);

  function addRule() {
    setRules([...(rules||[]), { id: `rule-${Date.now()}`, active: true, conditions: [], action: { addVariantId: '', quantity: 1 } }]);
  }
  function updateRule(idx, next) {
    const copy = [...rules];
    copy[idx] = { ...copy[idx], ...next };
    setRules(copy);
  }
  function removeRule(idx) {
    const copy = [...rules];
    copy.splice(idx, 1);
    setRules(copy);
  }
  function addCondition(idx, type) {
    const copy = [...rules];
    const r = copy[idx];
    if (type === 'cart_quantity_at_least') r.conditions.push({ type, threshold: 1 });
    if (type === 'cart_quantity_in_range') r.conditions.push({ type, min: 1 });
    if (type === 'cart_total_at_least') r.conditions.push({ type, amount: 1 });
    if (type === 'includes_any_variants') r.conditions.push({ type, variantIds: [] });
    if (type === 'includes_any_products') r.conditions.push({ type, productIds: [] });
    if (type === 'includes_any_collections') r.conditions.push({ type, collectionIds: [] });
    if (type === 'product_quantity_in_range') r.conditions.push({ type, productId: '', min: 1 });
    setRules(copy);
  }

  async function updateVariantDropdown(term) {
    setVariantTerm(term);
    if (!term.trim()) { setVariantOptions([]); setVariantOpen(false); return; }
    const prods = await fetchProducts(term);
    const opts = prods.flatMap(p => (p.variants||[]).map(v => ({ id: v.id, title: `${p.title} — ${v.title}` })));
    setVariantOptions(opts);
    setVariantOpen(true);
  }

  return (
    <div>
      <s-stack direction="inline">
        <s-button onClick={addRule}>Add Rule</s-button>
        <s-button onClick={() => navigator.clipboard.writeText(JSON.stringify(rules || [], null, 2))}>Copy JSON</s-button>
      </s-stack>
      {(rules || []).map((r, idx) => (
        <div key={r.id || idx} style={{
          border: 'none',
          borderRadius: 18,
          padding: 28,
          marginBottom: 28,
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
          transition: 'box-shadow 0.2s',
          fontFamily: 'Inter, system-ui, sans-serif',
          position: 'relative',
        }}>
          {validateRule(r).length > 0 && (<s-banner tone="critical">{validateRule(r).join(' • ')}</s-banner>)}
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
            <span style={{ fontWeight: 700, fontSize: 22, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 26 }}>🧩</span> Rule: {r.id || idx}
            </span>
            <s-text-field label="Rule ID" value={r.id || ''} onInput={(e) => updateRule(idx, { id: (/** @type {any} */(e.target)).value })} style={{ minWidth: 180, fontSize: 16 }} />
            <s-text-field label="Group (optional)" value={r.group || ''} onInput={(e) => updateRule(idx, { group: (/** @type {any} */(e.target)).value })} style={{ minWidth: 180, fontSize: 16 }} />
            <s-button tone="neutral" onClick={() => updateRule(idx, { active: !r.active })} style={{ fontWeight: 600, borderRadius: 8, background: r.active ? '#d1fae5' : '#f1f5f9', color: r.active ? '#047857' : '#64748b', border: 'none', padding: '8px 18px' }}>{r.active ? 'Active' : 'Inactive'}</s-button>
            <s-button tone="neutral" onClick={() => onValidate && onValidate(validateAll(rules))} style={{ borderRadius: 8, background: '#f1f5f9', color: '#334155', border: 'none', padding: '8px 18px' }}>Validate</s-button>
            <s-button tone="neutral" onClick={() => { if (onValidate) onValidate(validateAll(rules)); }} style={{ borderRadius: 8, background: '#f1f5f9', color: '#334155', border: 'none', padding: '8px 18px' }}>Save This Rule</s-button>
          </div>
          <s-divider />
          <s-text type="strong" style={{ fontSize: 18, color: '#334155', marginBottom: 8 }}>🧠 Conditions</s-text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <s-select label="Add Condition" value={selectedCond} onChange={(e) => setSelectedCond((/** @type {any} */(e.target)).value)}>
              <option value="cart_quantity_at_least">Cart quantity ≥</option>
              <option value="cart_quantity_in_range">Cart quantity between</option>
              <option value="cart_total_at_least">Cart total ≥</option>
              <option value="includes_any_variants">Includes variants</option>
              <option value="includes_any_products">Includes products</option>
              <option value="includes_any_collections">Includes collections</option>
              <option value="product_quantity_in_range">Specific product quantity between</option>
            </s-select>
            <s-button onClick={() => selectedCond && addCondition(idx, selectedCond)} disabled={!selectedCond}>Add</s-button>
          </div>
          {(r.conditions||[]).map((c, cIdx) => (
            <div key={cIdx} style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', background: '#f9fafb', borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ background: '#e0e7ef', color: '#334155', borderRadius: 6, padding: '2px 10px', fontWeight: 600, fontSize: 13 }}>{c.type}</span>
              {c.type === 'cart_quantity_at_least' && (
                <s-number-field label="Threshold" value={c.threshold}
                  onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].threshold = Number((/** @type {any} */(e.target)).value); setRules(copy); }} />
              )}
              {c.type === 'cart_quantity_in_range' && (
                <>
                  <s-number-field label="Min" value={c.min}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].min = Number((/** @type {any} */(e.target)).value); setRules(copy); }} />
                  <s-number-field label="Max (optional)" value={c.max ?? ''}
                    onInput={(e) => { const copy=[...rules]; const v=(/** @type {any} */(e.target)).value; copy[idx].conditions[cIdx].max = v===''?undefined:Number(v); setRules(copy); }} />
                </>
              )}
              {c.type === 'cart_total_at_least' && (
                <>
                  <s-number-field label="Amount" value={c.amount}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].amount = Number((/** @type {any} */(e.target)).value); setRules(copy); }} />
                  <s-text-field label="Currency" value={c.currencyCode || ''}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].currencyCode = (/** @type {any} */(e.target)).value; setRules(copy); }} />
                </>
              )}
              {c.type === 'includes_any_variants' && (
                <>
                  <s-text-field label="Variant GIDs (comma-separated)" value={(c.variantIds||[]).join(',')}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].variantIds = (/** @type {any} */(e.target)).value.split(',').map(s=>s.trim()).filter(Boolean); setRules(copy); }} />
                  <s-stack direction="inline">
                    <s-text-field label="Search products" onInput={() => { /* ephemeral */ }} />
                    <s-button onClick={searchProducts} disabled={searching}>Search</s-button>
                  </s-stack>
                  {(productResults||[]).slice(0,5).map((p) => (
                    <div key={p.id}>
                      <s-text type="strong">{p.title}</s-text>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {(p.variants||[]).map((v) => (
                          <s-button key={v.id} onClick={() => { const copy=[...rules]; const set=new Set(copy[idx].conditions[cIdx].variantIds||[]); set.add(v.id); copy[idx].conditions[cIdx].variantIds=Array.from(set); setRules(copy); }}>{v.title}</s-button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {c.type === 'includes_any_products' && (
                <>
                  <s-text-field label="Product GIDs (comma-separated)" value={(c.productIds||[]).join(',')}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].productIds = (/** @type {any} */(e.target)).value.split(',').map(s=>s.trim()).filter(Boolean); setRules(copy); }} />
                  <s-stack direction="inline">
                    <s-text-field label="Search products" onInput={() => { /* ephemeral */ }} />
                    <s-button onClick={searchProducts} disabled={searching}>Search</s-button>
                  </s-stack>
                  {(productResults||[]).slice(0,8).map((p) => (
                    <s-button key={p.id} onClick={() => { const copy=[...rules]; const set=new Set(copy[idx].conditions[cIdx].productIds||[]); set.add(p.id); copy[idx].conditions[cIdx].productIds=Array.from(set); setRules(copy); }}>{p.title}</s-button>
                  ))}
                </>
              )}
              {c.type === 'includes_any_collections' && (
                <CollectionsDropdown selected={(c.collectionIds||[])} onChange={(sel) => { const copy=[...rules]; copy[idx].conditions[cIdx].collectionIds = sel; setRules(copy); }} fetchCollections={fetchCollections} />
              )}
              {c.type === 'product_quantity_in_range' && (
                <>
                  <s-text-field label="Product GID" value={c.productId||''}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].productId = (/** @type {any} */(e.target)).value; setRules(copy); }} />
                  <s-stack direction="inline">
                    <s-text-field label="Search products" onInput={() => { /* ephemeral */ }} />
                    <s-button onClick={searchProducts} disabled={searching}>Search</s-button>
                  </s-stack>
                  {(productResults||[]).slice(0,8).map((p) => (
                    <s-button key={p.id} onClick={() => { const copy=[...rules]; copy[idx].conditions[cIdx].productId = p.id; setRules(copy); }}>{p.title}</s-button>
                  ))}
                  <s-number-field label="Min" value={c.min}
                    onInput={(e) => { const copy=[...rules]; copy[idx].conditions[cIdx].min = Number((/** @type {any} */(e.target)).value); setRules(copy); }} />
                  <s-number-field label="Max (optional)" value={c.max ?? ''}
                    onInput={(e) => { const copy=[...rules]; const v=(/** @type {any} */(e.target)).value; copy[idx].conditions[cIdx].max = v===''?undefined:Number(v); setRules(copy); }} />
                </>
              )}
              <s-button tone="critical" onClick={() => { const copy=[...rules]; copy[idx].conditions.splice(cIdx,1); setRules(copy); }}>Remove</s-button>
            </div>
          ))}
          <s-divider />
          <s-text type="strong" style={{ fontSize: 18, color: '#334155', margin: '18px 0 8px 0' }}>⚙️ Action</s-text>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 180px', alignItems: 'center' }}>
            <div style={{ position: 'relative', minWidth: 260 }}>
              <s-text-field label="Add Variant (search)" value={variantTerm}
                onInput={async (e) => { await updateVariantDropdown((/** @type {any} */(e.target)).value); }}
                onFocus={() => setVariantOpen(variantOptions.length > 0)} style={{ fontSize: 15 }} />
              {variantOpen && variantOptions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e1e3e5', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.10)', maxHeight: 260, overflowY: 'auto', zIndex: 10 }}>
                  {variantOptions.map(opt => (
                    <button type="button" key={opt.id} style={{ padding: '10px 14px', textAlign: 'left', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 15, borderBottom: '1px solid #f1f5f9' }} onClick={() => { updateRule(idx, { action: { ...(r.action||{}), addVariantId: opt.id } }); setVariantOpen(false); }}>
                      <span style={{ color: '#0f172a' }}>{opt.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <s-number-field label="Quantity" value={r.action?.quantity||1}
              onInput={(e) => updateRule(idx, { action: { ...(r.action||{}), quantity: Number((/** @type {any} */(e.target)).value) } })} />
            <div style={{ gridColumn: '1 / span 2', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ background: '#e0e7ef', color: '#334155', borderRadius: 6, padding: '2px 10px', fontWeight: 600, fontSize: 13 }}>Selected Variant ID</span>
              <s-text-field value={r.action?.addVariantId||''} onInput={(e) => updateRule(idx, { action: { ...(r.action||{}), addVariantId: (/** @type {any} */(e.target)).value } })} style={{ minWidth: 260, fontSize: 15 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <s-button tone="critical" onClick={() => removeRule(idx)}>Delete Rule</s-button>
          </div>
        </div>
      ))}
      <s-text type="strong">Preview JSON</s-text>
      <s-text-area value={JSON.stringify(rules||[], null, 2)} />
    </div>
  );
}