// =============================================================
//  Service-Shop Frontend
// =============================================================

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const cart = new Map();        // service_id -> { service, qty }
let services = [];
let cryptoOptions = [];
let selectedCurrency = null;

const fmt = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

// ---------- Services ----------
async function loadServices() {
    try {
        const r = await fetch('/api/services');
        services = await r.json();
        renderServices();
        $('#services-meta').textContent = services.length === 1 ? '1 Leistung' : `${services.length} Leistungen`;
    } catch (err) {
        $('#services-meta').textContent = 'Konnte nicht geladen werden';
        console.error(err);
    }
}

function renderServices() {
    const grid = $('#services-grid');
    if (services.length === 0) {
        grid.innerHTML = '<div class="empty-state"><strong>Gerade keine Leistungen</strong><span>Schau bald wieder vorbei – oder schreib an die Adresse unten.</span></div>';
        return;
    }
    grid.innerHTML = services.map(s => {
        const img = s.image_url
            ? `<img src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.style.opacity=0.3">`
            : `<div style="display:grid;place-items:center;height:100%;background:var(--verlauf);color:#fff;font:800 3rem var(--anzeige);opacity:.9;" aria-hidden="true">${escapeHtml((s.name || '?').charAt(0).toUpperCase())}</div>`;
        const cat = s.category ? `<span class="tag">${escapeHtml(s.category)}</span>` : '';
        const dur = s.duration ? `<span class="tag muted">${escapeHtml(s.duration)}</span>` : '';
        return `
        <article class="product-card">
            <div class="image">
                ${img}
                <span class="id-tag">#${String(s.id).padStart(4,'0')}</span>
            </div>
            <div class="body">
                <div class="tags">${cat}${dur}</div>
                <h3>${escapeHtml(s.name)}</h3>
                <p class="desc">${escapeHtml(s.description || '')}</p>
                <div class="row">
                    <span class="price">${fmt(s.price_cents)}</span>
                </div>
                <button class="add-btn" type="button" data-id="${s.id}" aria-label="${escapeHtml(s.name)} hinzufügen">Hinzufügen</button>
            </div>
        </article>`;
    }).join('');

    $$('.add-btn').forEach(b => b.addEventListener('click', e => {
        addToCart(parseInt(e.currentTarget.dataset.id, 10));
    }));
}

// ---------- Cart ----------
function addToCart(id) {
    const s = services.find(x => x.id === id);
    if (!s) return;
    const existing = cart.get(id);
    if (existing) existing.qty += 1;
    else cart.set(id, { service: s, qty: 1 });
    renderCart();
    toast(`${s.name} hinzugefügt`, 'success');
    openCart();
}

function changeQty(id, delta) {
    const item = cart.get(id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart.delete(id);
    renderCart();
}

function cartTotal() {
    let t = 0;
    for (const { service, qty } of cart.values()) t += service.price_cents * qty;
    return t;
}
function cartCount() {
    let c = 0;
    for (const { qty } of cart.values()) c += qty;
    return c;
}

function renderCart() {
    const items = $('#cart-items');
    const footer = $('#cart-footer');
    const count = cartCount();

    const cnt = $('#cart-count');
    if (count > 0) { cnt.style.display = 'block'; cnt.textContent = count; }
    else cnt.style.display = 'none';
    $('#cart-toggle').setAttribute('aria-label', count ? `Auswahl öffnen, ${count} ${count === 1 ? 'Leistung' : 'Leistungen'}` : 'Auswahl öffnen');

    if (cart.size === 0) {
        items.innerHTML = '<div class="cart-empty">Noch nichts ausgewählt.<br>Tippe bei einer Leistung auf „Hinzufügen“.</div>';
        footer.style.display = 'none';
        return;
    }

    items.innerHTML = [...cart.values()].map(({ service: s, qty }) => `
        <div class="cart-item">
            ${s.image_url ? `<img src="${escapeHtml(s.image_url)}" alt="" onerror="this.style.opacity=0.2">` : `<div style="width:56px;height:56px;border-radius:12px;background:var(--verlauf);flex:none;" aria-hidden="true"></div>`}
            <div class="info">
                <h4>${escapeHtml(s.name)}</h4>
                <div class="qty">${fmt(s.price_cents)} pro Einheit</div>
                <div class="controls">
                    <button type="button" data-id="${s.id}" data-d="-1" aria-label="${escapeHtml(s.name)}: eins weniger">−</button>
                    <span style="font-variant-numeric:tabular-nums;font-weight:600;min-width:24px;text-align:center;" aria-label="Menge">${qty}</span>
                    <button type="button" data-id="${s.id}" data-d="1" aria-label="${escapeHtml(s.name)}: eins mehr">+</button>
                </div>
            </div>
            <div class="price">${fmt(s.price_cents * qty)}</div>
        </div>
    `).join('');

    items.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', e => {
        changeQty(parseInt(e.currentTarget.dataset.id, 10), parseInt(e.currentTarget.dataset.d, 10));
    }));

    $('#cart-total').textContent = fmt(cartTotal());
    footer.style.display = 'block';
}

// ---------- Drawer Views ----------
// Blatt öffnen/schließen: Fokus ins Blatt und zurück, Esc schließt, Tab bleibt im Blatt, Seite dahinter nicht bedienbar
let fokusVorher = null;
function openCart() {
    if (!$('#cart-drawer').classList.contains('open')) fokusVorher = document.activeElement;
    $('#cart-drawer').classList.add('open'); $('#cart-overlay').classList.add('open');
    document.querySelectorAll('body > header, body > main, body > footer').forEach(x => { x.inert = true; });
    document.documentElement.style.overflow = 'hidden';
    showCartView();
    setTimeout(() => $('#cart-close').focus(), 50);
}
function closeCart() {
    $('#cart-drawer').classList.remove('open'); $('#cart-overlay').classList.remove('open');
    document.querySelectorAll('body > header, body > main, body > footer').forEach(x => { x.inert = false; });
    document.documentElement.style.overflow = '';
    (fokusVorher || $('#cart-toggle')).focus?.();
}
document.addEventListener('keydown', e => {
    if (!$('#cart-drawer').classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCart(); }
    if (e.key === 'Tab') {
        const f = [...$('#cart-drawer').querySelectorAll('button, input, textarea, a[href], [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
});

function setView(name) {
    ['cart-view', 'checkout-form', 'payment-view'].forEach(id => {
        $('#' + id).style.display = 'none';
    });
    if (name === 'cart')      { $('#cart-view').style.display = 'flex'; $('#drawer-title').textContent = 'Auswahl'; }
    if (name === 'checkout')  { $('#checkout-form').style.display = 'flex'; $('#checkout-form').style.flexDirection = 'column'; $('#drawer-title').textContent = 'Deine Angaben'; setTimeout(() => $('#f-name').focus(), 50); }
    if (name === 'payment')   { $('#payment-view').style.display = 'flex'; $('#payment-view').style.flexDirection = 'column'; $('#drawer-title').textContent = 'Zahlung'; }
}

function showCartView()     { setView('cart'); }
function showCheckoutView() {
    if (cart.size === 0) return;
    setView('checkout');
    renderCryptoOptions();
    const sum = $('#checkout-summary');
    const rows = [...cart.values()].map(({ service: s, qty }) =>
        `<div class="row"><span>${qty} × ${escapeHtml(s.name)}</span><span>${fmt(s.price_cents * qty)}</span></div>`
    ).join('');
    sum.innerHTML = rows + `<div class="row total"><span>Gesamt</span><span>${fmt(cartTotal())}</span></div>`;
}

// ---------- Crypto Options ----------
async function loadCryptoOptions() {
    try {
        const r = await fetch('/api/payment-options');
        cryptoOptions = await r.json();
    } catch { cryptoOptions = []; }
}

function renderCryptoOptions() {
    const box = $('#crypto-options');
    if (cryptoOptions.length === 0) {
        box.innerHTML = '<div style="color:var(--danger);font-size:var(--t-klein);">Gerade ist keine Zahlungsart eingerichtet – bitte später noch einmal versuchen.</div>';
        $('#place-order-btn').disabled = true;
        return;
    }
    if (!selectedCurrency) selectedCurrency = cryptoOptions[0].code;
    box.innerHTML = cryptoOptions.map(o => `
        <label class="crypto-opt ${selectedCurrency === o.code ? 'active' : ''}">
            <input type="radio" name="currency" value="${o.code}" ${selectedCurrency === o.code ? 'checked' : ''}>
            <span class="code">${o.code}</span>
            <span class="lbl">${escapeHtml(o.label)}</span>
        </label>
    `).join('');
    box.querySelectorAll('input[name=currency]').forEach(i => {
        i.addEventListener('change', e => {
            selectedCurrency = e.target.value;
            renderCryptoOptions();
        });
    });
    $('#place-order-btn').disabled = false;
}

// ---------- Order absenden ----------
async function placeOrder(e) {
    e.preventDefault();
    const form = e.target;
    const btn = $('#place-order-btn');
    btn.disabled = true;
    btn.textContent = 'Wird gesendet …';

    const items = [...cart.values()].map(({ service, qty }) => ({
        service_id: service.id, quantity: qty,
    }));

    try {
        const r = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_name:  form.customer_name.value.trim(),
                customer_email: form.customer_email.value.trim(),
                customer_phone: form.customer_phone.value.trim(),
                notes:          form.notes.value.trim(),
                payment_currency: selectedCurrency,
                items,
            }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Das hat nicht geklappt. Bitte noch einmal versuchen.');

        // Payment-View zeigen
        $('#confirm-id').textContent = '#' + data.order_id;
        $('#payment-currency-label').textContent = data.payment.label;
        $('#payment-amount').textContent = fmt(data.total_cents);
        $('#payment-address').textContent = data.payment.address;
        $('#payment-reference').textContent = data.payment.reference;
        setView('payment');

        cart.clear();
        renderCart();
        form.reset();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Anfrage senden';
    }
}

async function copyAddress() {
    const addr = $('#payment-address').textContent;
    try {
        await navigator.clipboard.writeText(addr);
        toast('Adresse kopiert', 'success');
    } catch {
        toast('Kopieren nicht möglich – bitte markieren und kopieren', 'error');
    }
}

// ---------- Init ----------
async function loadConfig() {
    try {
        const r = await fetch('/api/config');
        const cfg = await r.json();
        if (cfg.business_name) {
            $('#footer-business').textContent =
                `© ${new Date().getFullYear()} ${cfg.business_name} · ${cfg.business_email}`;
            document.title = `Leistungen – ${cfg.business_name}`;
        }
    } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    loadServices();
    loadCryptoOptions();
    $('#cart-toggle').addEventListener('click', openCart);
    $('#cart-close').addEventListener('click', closeCart);
    $('#cart-overlay').addEventListener('click', closeCart);
    $('#checkout-btn').addEventListener('click', showCheckoutView);
    $('#back-to-cart').addEventListener('click', showCartView);
    $('#back-to-cart').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCartView(); } });
    $('#checkout-form').addEventListener('submit', placeOrder);
    $('#payment-done-btn').addEventListener('click', closeCart);
    $('#copy-address').addEventListener('click', copyAddress);
});
