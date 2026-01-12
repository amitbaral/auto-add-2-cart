/**
 * Auto Add to Cart - Storefront JavaScript
 * Monitors cart changes and automatically adds/removes products based on rules.
 */
(function () {
    'use strict';

    const AUTO_ADD_PROPERTY = '_auto_added';
    let rules = [];
    let processing = false;
    let lastCartToken = null;

    /**
     * Fetch rules from the app proxy
     */
    async function fetchRules() {
        try {
            const settingsEl = document.getElementById('auto-add-settings');
            if (!settingsEl) {
                console.log('[AutoAdd] Settings element not found');
                return;
            }

            const settings = JSON.parse(settingsEl.textContent);
            const response = await fetch(settings.proxyUrl + '?shop=' + window.Shopify.shop);

            if (!response.ok) {
                throw new Error('Failed to fetch rules: ' + response.status);
            }

            const data = await response.json();
            rules = data.rules || [];
            console.log('[AutoAdd] Loaded', rules.length, 'active rules');
        } catch (error) {
            console.error('[AutoAdd] Error fetching rules:', error);
        }
    }

    /**
     * Get the current cart
     */
    async function getCart() {
        // Skip on checkout pages where /cart.js isn't accessible
        if (window.location.pathname.includes('/checkouts/')) {
            return null;
        }

        try {
            const response = await fetch('/cart.js');
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            // Silently fail on checkout/other pages where cart.js isn't available
            return null;
        }
    }

    /**
     * Add a product to cart
     */
    async function addToCart(variantId, quantity) {
        try {
            const response = await fetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: [{
                        id: parseInt(variantId.replace('gid://shopify/ProductVariant/', '')),
                        quantity: quantity,
                        properties: { [AUTO_ADD_PROPERTY]: 'true' }
                    }]
                })
            });

            if (!response.ok) {
                throw new Error('Failed to add to cart: ' + response.status);
            }

            console.log('[AutoAdd] Added variant', variantId);
            return true;
        } catch (error) {
            console.error('[AutoAdd] Error adding to cart:', error);
            return false;
        }
    }

    /**
     * Show/hide loading spinner inside cart drawer during cart operations
     */
    function showSpinner() {
        // Find the cart drawer
        const cartDrawer = document.querySelector('cart-drawer, #cart-drawer, .cart-drawer, [data-cart-drawer]');
        if (!cartDrawer) return;

        // Create spinner if it doesn't exist
        let spinner = document.getElementById('auto-add-spinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.id = 'auto-add-spinner';
            spinner.innerHTML = `
                <div class="auto-add-spinner-overlay">
                    <div class="auto-add-spinner-icon"></div>
                </div>
            `;

            // Add CSS (only once)
            if (!document.getElementById('auto-add-spinner-styles')) {
                const style = document.createElement('style');
                style.id = 'auto-add-spinner-styles';
                style.textContent = `
                    #auto-add-spinner {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        z-index: 100;
                        pointer-events: none;
                    }
                    #auto-add-spinner .auto-add-spinner-overlay {
                        width: 100%;
                        height: 100%;
                        background: rgba(255, 255, 255, 0.7);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0;
                        transition: opacity 0.15s ease;
                    }
                    #auto-add-spinner .auto-add-spinner-overlay.visible {
                        opacity: 1;
                    }
                    #auto-add-spinner .auto-add-spinner-icon {
                        width: 28px;
                        height: 28px;
                        border: 3px solid #e0e0e0;
                        border-top-color: #333;
                        border-radius: 50%;
                        animation: auto-add-spin 0.7s linear infinite;
                    }
                    @keyframes auto-add-spin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        // Ensure cart drawer has position relative for absolute positioning
        if (getComputedStyle(cartDrawer).position === 'static') {
            cartDrawer.style.position = 'relative';
        }

        // Append to cart drawer if not already there
        if (!cartDrawer.contains(spinner)) {
            cartDrawer.appendChild(spinner);
        }

        const overlay = spinner.querySelector('.auto-add-spinner-overlay');
        if (overlay) {
            setTimeout(() => overlay.classList.add('visible'), 10);
        }
    }

    function hideSpinner() {
        const spinner = document.getElementById('auto-add-spinner');
        if (spinner) {
            const overlay = spinner.querySelector('.auto-add-spinner-overlay');
            if (overlay) {
                overlay.classList.remove('visible');
            }
        }
    }


    /**
     * Refresh the cart UI to show changes immediately
     * Optimized for speed - minimal network requests
     */
    async function refreshCartUI() {
        try {
            // Single fetch to get section and cart in one go
            const cartDrawer = document.querySelector('cart-drawer');
            const section = cartDrawer?.closest('[id^="shopify-section"]');
            const sectionId = section?.id?.replace('shopify-section-', '') || 'cart-drawer';

            // Fetch section with cart data - single network request
            const response = await fetch(`${window.location.pathname}?section_id=${sectionId}`);
            if (response.ok) {
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Update cart drawer content
                const newContent = doc.querySelector('.drawer__inner, .cart-drawer__inner, cart-drawer-items, .cart-items');
                const currentContent = cartDrawer?.querySelector('.drawer__inner, .cart-drawer__inner, cart-drawer-items, .cart-items');

                if (newContent && currentContent) {
                    currentContent.innerHTML = newContent.innerHTML;
                }

                // Update cart count from new HTML
                const newBubble = doc.querySelector('.cart-count-bubble span');
                if (newBubble) {
                    document.querySelectorAll('.cart-count-bubble span').forEach(span => {
                        span.textContent = newBubble.textContent;
                    });
                }
            }

            // Quick event dispatch - no await needed
            document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

            // Hide controls for gift products
            await hideGiftControls();

        } catch (error) {
            console.error('[AutoAdd] Refresh error:', error);
        }
    }

    /**
     * Hide quantity controls and remove button for auto-added gift products
     */
    async function hideGiftControls() {
        try {
            const cart = await getCart();
            if (!cart) {
                console.log('[AutoAdd] hideGiftControls: no cart');
                return;
            }

            // Find auto-added items (gifts)
            const giftVariantIds = cart.items
                .filter(item => item.properties && item.properties[AUTO_ADD_PROPERTY] === 'true')
                .map(item => String(item.variant_id));

            console.log('[AutoAdd] Gift variant IDs:', giftVariantIds);

            if (giftVariantIds.length === 0) {
                console.log('[AutoAdd] No gift items to style');
                return;
            }

            // Inject CSS to hide controls (only once)
            if (!document.getElementById('auto-add-gift-styles')) {
                const style = document.createElement('style');
                style.id = 'auto-add-gift-styles';
                style.textContent = `
                    .auto-add-gift-item .quantity,
                    .auto-add-gift-item .cart-item__quantity,
                    .auto-add-gift-item quantity-input,
                    .auto-add-gift-item .quantity-selector,
                    .auto-add-gift-item .quantity__input,
                    .auto-add-gift-item .quantity__button,
                    .auto-add-gift-item cart-remove-button,
                    .auto-add-gift-item .cart__remove,
                    .auto-add-gift-item .remove,
                    .auto-add-gift-item [data-cart-remove],
                    .auto-add-gift-item button[name="minus"],
                    .auto-add-gift-item button[name="plus"],
                    .auto-add-gift-item .js-qty,
                    .auto-add-gift-item .cart-item__remove,
                    .auto-add-gift-item .quantity__wrapper,
                    .auto-add-gift-item .cart-item__quantity-wrapper {
                        display: none !important;
                    }
                `;
                document.head.appendChild(style);
                console.log('[AutoAdd] Injected gift styles CSS');
            }

            // Find cart line items and mark gifts
            const cartItemSelectors = [
                'cart-drawer-items > div',
                'cart-items .cart-item',
                '.cart-drawer .cart-item',
                '.cart-items tr',
                '[data-cart-item]',
                '.cart__item',
                '.cart-item',
                'cart-drawer-items .cart-item',
                '.drawer__contents .cart-item',
                'tr[data-variant-id]'
            ];

            let foundItems = 0;
            let markedItems = 0;

            for (const selector of cartItemSelectors) {
                const items = document.querySelectorAll(selector);
                if (items.length > 0) {
                    console.log('[AutoAdd] Found', items.length, 'items with selector:', selector);
                }

                items.forEach(item => {
                    foundItems++;

                    // Method 1: Check data attributes on the item
                    let variantId = item.dataset?.variantId || item.dataset?.id || item.dataset?.lineItemKey?.split(':')[0];

                    // Method 2: Check key attribute (Dawn theme uses this)  
                    if (!variantId && item.dataset?.key) {
                        const keyMatch = item.dataset.key.match(/^(\d+)/);
                        if (keyMatch) variantId = keyMatch[1];
                    }

                    // Method 3: Check product link URL for variant parameter
                    if (!variantId) {
                        const productLink = item.querySelector('a[href*="variant="], a[href*="/products/"]');
                        if (productLink) {
                            const variantMatch = productLink.href.match(/variant=(\d+)/);
                            if (variantMatch) variantId = variantMatch[1];
                        }
                    }

                    // Method 4: Check hidden input
                    if (!variantId) {
                        const input = item.querySelector('[name*="id"], [name*="variant"], input[type="hidden"]');
                        variantId = input?.value;
                    }

                    // Method 5: Check quantity-input element (Dawn theme)
                    if (!variantId) {
                        const qtyInput = item.querySelector('quantity-input');
                        if (qtyInput) {
                            variantId = qtyInput.dataset?.index?.split(':')[0];
                        }
                    }

                    // Method 6: Check any input with data-index
                    if (!variantId) {
                        const indexInput = item.querySelector('[data-index], input[data-index]');
                        if (indexInput) {
                            const idx = indexInput.dataset?.index || indexInput.getAttribute('data-index');
                            variantId = idx?.split(':')[0];
                        }
                    }

                    // Method 7: Check quantity input name
                    if (!variantId) {
                        const qtyInput = item.querySelector('input[name*="updates"]');
                        if (qtyInput) {
                            const match = qtyInput.name.match(/updates\[(\d+)\]/);
                            variantId = match ? match[1] : null;
                        }
                    }

                    // Method 8: Check cart-remove-button or remove links
                    if (!variantId) {
                        const removeBtn = item.querySelector('cart-remove-button, a[href*="/cart/change"], button[data-variant-id]');
                        if (removeBtn) {
                            // Check data-index on cart-remove-button (Dawn theme)
                            variantId = removeBtn.dataset?.index?.split(':')[0];
                            if (!variantId) variantId = removeBtn.dataset?.variantId;
                            if (!variantId && removeBtn.href) {
                                const match = removeBtn.href.match(/id=(\d+)/);
                                variantId = match ? match[1] : null;
                            }
                        }
                    }

                    // Method 9: Check data-line-item-key anywhere in the item
                    if (!variantId) {
                        const keyEl = item.querySelector('[data-line-item-key], [data-cart-item-key]');
                        if (keyEl) {
                            const key = keyEl.dataset?.lineItemKey || keyEl.dataset?.cartItemKey;
                            variantId = key?.split(':')[0];
                        }
                    }

                    // Debug: log first item's HTML if no variant found
                    if (!variantId && foundItems <= 2) {
                        console.log('[AutoAdd] DEBUG - Item HTML:', item.outerHTML.substring(0, 500));
                    }

                    console.log('[AutoAdd] Item variant ID found:', variantId, 'Item:', item.className);

                    if (variantId && giftVariantIds.includes(String(variantId))) {
                        item.classList.add('auto-add-gift-item');
                        markedItems++;
                        console.log('[AutoAdd] Marked item as gift:', variantId);
                    } else {
                        item.classList.remove('auto-add-gift-item');
                    }
                });
            }

            console.log('[AutoAdd] hideGiftControls: found', foundItems, 'items, marked', markedItems, 'as gifts');

        } catch (error) {
            console.error('[AutoAdd] Error hiding gift controls:', error);
        }
    }

    /**
     * Set up observer to re-apply gift controls hiding when cart drawer content changes
     */
    function setupGiftControlsObserver() {
        // Watch for changes to cart drawer content
        const cartDrawer = document.querySelector('cart-drawer, #cart-drawer, .cart-drawer, [data-cart-drawer]');
        if (cartDrawer) {
            const observer = new MutationObserver((mutations) => {
                // Check if any actual content changed (not just classes)
                const hasContentChange = mutations.some(m =>
                    m.type === 'childList' && m.addedNodes.length > 0
                );
                if (hasContentChange) {
                    console.log('[AutoAdd] Cart drawer content changed, re-hiding gift controls');
                    setTimeout(hideGiftControls, 100);
                }
            });

            observer.observe(cartDrawer, {
                childList: true,
                subtree: true
            });
            console.log('[AutoAdd] Gift controls observer set up on cart drawer');
        }

        // Also watch for any cart-items containers
        document.querySelectorAll('cart-items, .cart-items, cart-drawer-items').forEach(container => {
            const observer = new MutationObserver(() => {
                setTimeout(hideGiftControls, 100);
            });
            observer.observe(container, {
                childList: true,
                subtree: true
            });
        });
    }

    /**
     * Get the current cart item count
     */
    async function getCartCount() {
        try {
            const cart = await getCart();
            return cart ? cart.item_count : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Remove an auto-added product from cart by line key
     */
    async function removeFromCart(lineKey) {
        try {
            console.log('[AutoAdd] Removing item with key:', lineKey);
            const response = await fetch('/cart/change.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: String(lineKey),
                    quantity: 0
                })
            });

            const result = await response.json();

            if (!response.ok || result.status === 422) {
                console.error('[AutoAdd] Remove failed:', result);
                return false;
            }

            console.log('[AutoAdd] Removed item successfully');
            return true;
        } catch (error) {
            console.error('[AutoAdd] Error removing from cart:', error);
            return false;
        }
    }

    /**
     * Update cart item quantity by line key (used to enforce gift quantity = 1)
     */
    async function updateCartItemQuantity(lineKey, quantity) {
        try {
            console.log('[AutoAdd] Updating item key:', lineKey, 'to qty:', quantity);
            const response = await fetch('/cart/change.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: String(lineKey),
                    quantity: quantity
                })
            });

            const result = await response.json();

            if (!response.ok || result.status === 422) {
                console.error('[AutoAdd] Update failed:', result);
                return false;
            }

            console.log('[AutoAdd] Updated item to quantity', quantity);
            return true;
        } catch (error) {
            console.error('[AutoAdd] Error updating cart:', error);
            return false;
        }
    }  /**
     * Check if a rule's conditions are met
     */
    function evaluateRule(rule, cart) {
        if (!rule.conditions || rule.conditions.length === 0) {
            console.log('[AutoAdd] Rule has no conditions:', rule.id);
            return false;
        }

        console.log('[AutoAdd] Evaluating rule:', rule.id, 'conditions:', rule.conditions.length);

        for (const cond of rule.conditions) {
            console.log('[AutoAdd] Checking condition:', cond.type, cond);

            switch (cond.type) {
                case 'product_quantity_in_range': {
                    // Extract product ID number from GID
                    const targetProductId = cond.productId.replace('gid://shopify/Product/', '');
                    let totalQty = 0;

                    // Don't count auto-added gift items in the quantity
                    for (const item of cart.items) {
                        // Skip auto-added items when counting trigger product quantity
                        if (item.properties && item.properties[AUTO_ADD_PROPERTY] === 'true') {
                            continue;
                        }
                        if (String(item.product_id) === targetProductId) {
                            totalQty += item.quantity;
                        }
                    }

                    console.log('[AutoAdd] Product qty check: target=', targetProductId, 'totalQty=', totalQty, 'range=', cond.min, '-', cond.max);

                    if (totalQty < cond.min) {
                        console.log('[AutoAdd] Qty', totalQty, '< min', cond.min, '- condition FAILED');
                        return false;
                    }
                    if (cond.max !== undefined && cond.max !== null && totalQty > cond.max) {
                        console.log('[AutoAdd] Qty', totalQty, '> max', cond.max, '- condition FAILED');
                        return false;
                    }
                    console.log('[AutoAdd] Condition PASSED');
                    break;
                }

                case 'cart_total_gte': {
                    const cartTotal = cart.total_price / 100; // Convert cents to dollars
                    console.log('[AutoAdd] Cart total check: total=', cartTotal, 'min=', cond.value);
                    if (cartTotal < cond.value) {
                        console.log('[AutoAdd] Cart total', cartTotal, '< min', cond.value, '- condition FAILED');
                        return false;
                    }
                    console.log('[AutoAdd] Condition PASSED');
                    break;
                }

                default:
                    console.log('[AutoAdd] Unknown condition type:', cond.type);
                    return false;
            }
        }

        console.log('[AutoAdd] All conditions PASSED for rule:', rule.id);
        return true;
    }

    /**
     * Process cart and apply rules
     */
    async function processCart() {
        if (processing) {
            console.log('[AutoAdd] Already processing, skipping');
            return;
        }
        processing = true;

        try {
            const cart = await getCart();
            if (!cart) {
                console.log('[AutoAdd] Failed to get cart');
                processing = false;
                return;
            }

            console.log('[AutoAdd] Cart token:', cart.token, 'Last token:', lastCartToken);

            // Skip if cart hasn't changed
            if (cart.token === lastCartToken) {
                console.log('[AutoAdd] Cart unchanged, skipping');
                processing = false;
                return;
            }
            lastCartToken = cart.token;

            console.log('[AutoAdd] Processing cart with', cart.items.length, 'items');

            // Find auto-added items currently in cart
            const autoAddedItems = cart.items.filter(item =>
                item.properties && item.properties[AUTO_ADD_PROPERTY] === 'true'
            );
            console.log('[AutoAdd] Found', autoAddedItems.length, 'auto-added items in cart');

            // Track which variant IDs should be in cart based on current rules
            const shouldHaveVariants = new Map(); // variantGid -> rule
            const seenGroups = new Set();

            console.log('[AutoAdd] Evaluating', rules.length, 'rules');

            for (const rule of rules) {
                const matches = evaluateRule(rule, cart);

                if (matches) {
                    // Check group logic
                    if (rule.group) {
                        if (seenGroups.has(rule.group)) continue;
                        seenGroups.add(rule.group);
                    }

                    console.log('[AutoAdd] Rule', rule.id, 'matched, adding variant to shouldHave:', rule.action.addVariantId);
                    shouldHaveVariants.set(rule.action.addVariantId, rule);
                }
            }

            console.log('[AutoAdd] Should have', shouldHaveVariants.size, 'gift variants');

            let madeChanges = false;

            // Check auto-added items: remove if no longer needed, enforce quantity = 1
            for (const item of autoAddedItems) {
                const variantGid = 'gid://shopify/ProductVariant/' + item.variant_id;

                if (!shouldHaveVariants.has(variantGid)) {
                    // Condition no longer matches - remove the gift
                    console.log('[AutoAdd] Condition no longer matches, removing gift:', variantGid, 'key:', item.key);
                    showSpinner();
                    await removeFromCart(item.key);
                    madeChanges = true;
                } else {
                    // Gift should be in cart - but enforce quantity = 1
                    if (item.quantity !== 1) {
                        console.log('[AutoAdd] Resetting gift quantity to 1:', variantGid, 'key:', item.key, 'was:', item.quantity);
                        showSpinner();
                        await updateCartItemQuantity(item.key, 1);
                        madeChanges = true;
                    }
                    // Mark as handled
                    console.log('[AutoAdd] Gift already in cart with correct qty, removing from shouldHave:', variantGid);
                    shouldHaveVariants.delete(variantGid);
                }
            }

            console.log('[AutoAdd] After checking existing, need to add', shouldHaveVariants.size, 'gifts');

            // Add missing gifts (conditions match but gift not in cart)
            for (const [variantGid, rule] of shouldHaveVariants) {
                // Check if variant exists in cart (even without auto-add property)
                const numericId = variantGid.replace('gid://shopify/ProductVariant/', '');
                console.log('[AutoAdd] Checking if variant', numericId, 'exists in cart');

                const existingItem = cart.items.find(item =>
                    String(item.variant_id) === numericId
                );

                console.log('[AutoAdd] Existing item found:', existingItem ? 'YES' : 'NO');

                if (!existingItem) {
                    // Gift is missing - add it
                    console.log('[AutoAdd] Adding gift variant:', variantGid);
                    showSpinner();
                    const added = await addToCart(variantGid, 1);
                    console.log('[AutoAdd] Add result:', added);
                    madeChanges = true;
                } else if (!existingItem.properties || existingItem.properties[AUTO_ADD_PROPERTY] !== 'true') {
                    // Variant exists but wasn't auto-added (customer added it manually)
                    // Don't interfere with manually added items
                    console.log('[AutoAdd] Gift variant exists but was added manually, skipping:', variantGid);
                } else if (existingItem.quantity !== 1) {
                    // Auto-added but wrong quantity - fix it
                    console.log('[AutoAdd] Fixing gift quantity to 1:', variantGid);
                    showSpinner();
                    await updateCartItemQuantity(existingItem.key, 1);
                    madeChanges = true;
                }
            }

            console.log('[AutoAdd] Made changes:', madeChanges);

            // If we made changes, reset cart token and refresh UI
            if (madeChanges) {
                lastCartToken = null;

                // Refresh the cart UI - this is critical for the user to see changes immediately
                await refreshCartUI();
            }
        } finally {
            hideSpinner();
            processing = false;
        }
    }

    /**
     * Monitor for cart changes
     */
    function setupCartMonitoring() {
        // Poll for cart changes every 3 seconds (reduced frequency)
        setInterval(processCart, 3000);

        // Also process on page load
        processCart();

        // Intercept fetch calls to cart modification endpoints ONLY
        const originalFetch = window.fetch;
        window.fetch = function (...args) {
            return originalFetch.apply(this, args).then(response => {
                const url = args[0];
                // Only trigger on cart MODIFICATIONS, not reads
                if (typeof url === 'string' &&
                    (url.includes('/cart/add') ||
                        url.includes('/cart/change') ||
                        url.includes('/cart/update') ||
                        url.includes('/cart/clear'))) {
                    // Cart was modified, trigger re-evaluation after a short delay
                    console.log('[AutoAdd] Cart modification detected:', url);
                    lastCartToken = null; // Force re-evaluation
                    setTimeout(processCart, 500);
                }
                return response;
            });
        };

        // Also listen for form submissions to cart
        document.addEventListener('submit', function (e) {
            const form = e.target;
            if (form.action && form.action.includes('/cart/add')) {
                lastCartToken = null; // Force re-evaluation
                setTimeout(processCart, 1000);
            }
        });

        // Listen for clicks on cart icons/buttons (common selectors)
        document.addEventListener('click', function (e) {
            const target = e.target.closest('[data-cart-trigger], [data-drawer-toggle], .cart-icon, .cart-link, [href="/cart"], .js-cart-drawer-trigger, .cart-count-bubble, .header__icon--cart, [data-action="open-drawer"]');
            if (target) {
                lastCartToken = null; // Force re-evaluation when cart opens
                setTimeout(processCart, 300);
            }
        });

        // MutationObserver to detect cart drawer becoming visible
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;
                    // Check for common cart drawer patterns
                    if (target.classList.contains('cart-drawer') ||
                        target.classList.contains('drawer') ||
                        target.id === 'cart-drawer' ||
                        target.id === 'CartDrawer' ||
                        target.dataset.section === 'cart-drawer') {

                        const isVisible = !target.classList.contains('hidden') &&
                            !target.classList.contains('is-closed') &&
                            target.getAttribute('aria-hidden') !== 'true' &&
                            getComputedStyle(target).display !== 'none';

                        if (isVisible) {
                            console.log('[AutoAdd] Cart drawer opened, checking rules...');
                            lastCartToken = null; // Force re-evaluation
                            processCart();
                            hideGiftControls(); // Hide controls for gift items
                        }
                    }
                }
            });
        });

        // Observe the document body for attribute changes on cart drawers
        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class', 'aria-hidden', 'style', 'open']
        });

        // Also listen for custom events that themes might dispatch
        document.addEventListener('cart:open', function () {
            console.log('[AutoAdd] cart:open event detected');
            lastCartToken = null;
            processCart();
        });

        document.addEventListener('shopify:section:load', function () {
            lastCartToken = null;
            processCart();
        });
    }

    /**
     * Initialize
     */
    async function init() {
        console.log('[AutoAdd] Initializing...');
        await fetchRules();
        setupCartMonitoring();
        setupGiftControlsObserver(); // Watch for cart drawer content changes
        hideGiftControls(); // Apply gift styling on page load
        console.log('[AutoAdd] Ready');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
