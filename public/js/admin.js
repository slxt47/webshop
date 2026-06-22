// =============================================================
//  Admin Frontend
// =============================================================

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const fmt = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const fmtDate = iso => new Date(iso).toLocaleString('de-DE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
});
const fmtDay = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

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

const STATUS_LABELS = {
    pending: 'pending', in_progress: 'in progress',
    completed: 'completed', cancelled: 'cancelled',
};

// ---------- Auth ----------
async function checkAuth() {
    try {
        const r = await fetch('/api/admin/me');
        if (r.ok) {
            const me = await r.json();
            showDashboard(me.username);
            return true;
        }
    } catch {}
    return false;
}

function showDashboard(username) {
    $('#login-view').style.display = 'none';
    $('#dashboard-view').style.display = 'block';
    $('#me-badge').textContent = '@' + username;
    loadAnalytics();
}

async function login(e) {
    e.preventDefault();
    const form = e.target;
    const err = $('#login-error');
    err.textContent = '';
    try {
        const r = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: form.username.value,
                password: form.password.value,
            }),
        });
        const data = await r.json();
        if (!r.ok) { err.textContent = '✗ ' + (data.error || 'Login fehlgeschlagen'); return; }
        await checkAuth();
    } catch {
        err.textContent = '✗ Netzwerkfehler';
    }
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
}

// ---------- Tabs ----------
function setupTabs() {
    $$('.admin-tabs .tab').forEach(t => {
        t.addEventListener('click', () => {
            $$('.admin-tabs .tab').forEach(x => x.classList.remove('active'));
            $$('.tab-panel').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            $('#tab-' + t.dataset.tab).classList.add('active');
            if (t.dataset.tab === 'analytics') loadAnalytics();
            if (t.dataset.tab === 'services')  loadServices();
            if (t.dataset.tab === 'orders')    loadOrders();
        });
    });
}

// ============================================================
//  ANALYTICS
// ============================================================

async function loadAnalytics() {
    const r = await fetch('/api/admin/analytics');
    if (!r.ok) return;
    const a = await r.json();
    renderStats(a.stats);
    renderChart14d(a.chart_14d);
    renderTopServices(a.top_services);
    renderStatusDist(a.by_status);
    renderPaymentDist(a.by_payment);
    renderRecent(a.recent);
}

function renderStats(s) {
    $('#stat-cards').innerHTML = `
        <div class="stat-card">
            <div class="label">umsatz (bezahlt)</div>
            <div class="value accent">${fmt(s.paid_revenue)}</div>
            <div class="sub">letzte 30 Tage: ${fmt(s.revenue_30d)}</div>
        </div>
        <div class="stat-card">
            <div class="label">offene zahlungen</div>
            <div class="value warning">${fmt(s.unpaid_revenue)}</div>
            <div class="sub">noch nicht eingegangen</div>
        </div>
        <div class="stat-card">
            <div class="label">bestellungen gesamt</div>
            <div class="value">${s.total_orders}</div>
            <div class="sub">letzte 30 Tage: ${s.orders_30d}</div>
        </div>
        <div class="stat-card">
            <div class="label">durchschnitt</div>
            <div class="value">${s.total_orders ? fmt(Math.round((s.paid_revenue + s.unpaid_revenue) / s.total_orders)) : '—'}</div>
            <div class="sub">je bestellung</div>
        </div>
    `;
}

function renderChart14d(data) {
    if (!data || data.length === 0) {
        $('#chart-14d').innerHTML = '<div class="empty-state">keine daten</div>';
        return;
    }
    const max = Math.max(...data.map(d => d.revenue), 100);
    const W = 100, H = 32;     // pro Tag
    const totalW = data.length * W;
    const bars = data.map((d, i) => {
        const h = (d.revenue / max) * 140;
        const x = i * W;
        const y = 160 - h;
        const isToday = i === data.length - 1;
        return `
            <g>
                <rect x="${x + 14}" y="${y}" width="${W - 28}" height="${h}"
                      fill="${isToday ? 'var(--accent)' : 'var(--accent-dim)'}"
                      opacity="${d.revenue > 0 ? 0.9 : 0.15}"
                      rx="3" ry="3">
                    <title>${fmtDay(d.day)}: ${fmt(d.revenue)} (${d.orders} order${d.orders!==1?'s':''})</title>
                </rect>
                <text x="${x + W/2}" y="178" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--text-low)">
                    ${fmtDay(d.day)}
                </text>
                ${d.revenue > 0 ? `
                <text x="${x + W/2}" y="${y - 4}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--text-dim)">
                    ${(d.revenue / 100).toFixed(0)}€
                </text>` : ''}
            </g>
        `;
    }).join('');

    $('#chart-14d').innerHTML = `
        <div style="overflow-x:auto;">
            <svg viewBox="0 0 ${totalW} 200" style="width:100%;min-width:${totalW * 0.6}px;height:200px;display:block;">
                ${bars}
            </svg>
        </div>
    `;
}

function renderTopServices(top) {
    const box = $('#top-services');
    if (!top || top.length === 0) {
        box.innerHTML = '<div class="empty-state">noch keine daten</div>';
        return;
    }
    const max = Math.max(...top.map(t => t.revenue));
    box.innerHTML = top.map(t => `
        <div class="rank-row">
            <div class="rank-info">
                <div class="rank-name">${escapeHtml(t.service_name)}</div>
                <div class="rank-bar"><div class="rank-fill" style="width:${(t.revenue/max)*100}%"></div></div>
            </div>
            <div class="rank-stats">
                <div class="rank-revenue">${fmt(t.revenue)}</div>
                <div class="rank-qty">${t.qty}× verkauft</div>
            </div>
        </div>
    `).join('');
}

function renderStatusDist(rows) {
    const box = $('#status-dist');
    if (!rows || rows.length === 0) { box.innerHTML = '<div class="empty-state">—</div>'; return; }
    box.innerHTML = rows.map(r => `
        <div class="dist-row">
            <span class="status-badge ${r.status}">${STATUS_LABELS[r.status] || r.status}</span>
            <span class="dist-count">${r.c}</span>
        </div>
    `).join('');
}

function renderPaymentDist(rows) {
    const box = $('#payment-dist');
    if (!rows || rows.length === 0) { box.innerHTML = '<div class="empty-state">—</div>'; return; }
    box.innerHTML = rows.map(r => `
        <div class="dist-row">
            <span class="crypto-tag">${escapeHtml(r.code)}</span>
            <span style="flex:1;color:var(--text-dim);font-family:var(--mono);font-size:12px;">
                ${r.c} order${r.c!==1?'s':''}
            </span>
            <span class="dist-count accent">${fmt(r.revenue)}</span>
        </div>
    `).join('');
}

function renderRecent(rows) {
    const box = $('#recent-orders');
    if (!rows || rows.length === 0) {
        box.innerHTML = '<div class="empty-state">noch keine bestellungen</div>';
        return;
    }
    box.innerHTML = `
        <div class="recent-table">
            ${rows.map(o => `
                <div class="recent-row">
                    <span class="recent-id">#${String(o.id).padStart(5, '0')}</span>
                    <span class="recent-name">${escapeHtml(o.customer_name)}</span>
                    <span class="recent-when">${fmtDate(o.created_at)}</span>
                    <span class="status-badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
                    <span class="status-badge ${o.payment_status === 'paid' ? 'shipped' : 'pending'}">${o.payment_status}</span>
                    <span class="recent-total">${fmt(o.total_cents)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================================
//  SERVICES CRUD
// ============================================================

let editingId = null;

async function loadServices() {
    const r = await fetch('/api/admin/services');
    const services = await r.json();
    $('#services-meta').textContent = `${services.length} services`;
    const list = $('#admin-services');
    if (services.length === 0) {
        list.innerHTML = '<div class="empty-state">noch keine services</div>';
        return;
    }
    list.innerHTML = services.map(s => `
        <div class="admin-product-row">
            <img src="${escapeHtml(s.image_url || '')}" alt="" onerror="this.style.opacity=0.2">
            <div class="meta">
                <h4>${escapeHtml(s.name)} ${s.active ? '' : '<span style="color:var(--text-low);font-size:11px;">(versteckt)</span>'}</h4>
                <div class="sub">#${String(s.id).padStart(4,'0')}${s.category ? ' · ' + escapeHtml(s.category) : ''}${s.duration ? ' · ' + escapeHtml(s.duration) : ''}</div>
            </div>
            <div class="price">${fmt(s.price_cents)}</div>
            <div class="actions">
                <button data-edit="${s.id}">edit</button>
                <button class="danger" data-del="${s.id}">del</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
        const id = parseInt(e.target.dataset.edit, 10);
        startEdit(services.find(s => s.id === id));
    }));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => {
        deleteService(parseInt(e.target.dataset.del, 10));
    }));
}

function startEdit(s) {
    editingId = s.id;
    const f = $('#service-form');
    f.id.value = s.id;
    f.name.value = s.name;
    f.description.value = s.description || '';
    f.price_eur.value = (s.price_cents / 100).toFixed(2);
    f.category.value = s.category || '';
    f.duration.value = s.duration || '';
    f.image_url.value = s.image_url || '';
    f.active.checked = !!s.active;
    $('#service-form-title').textContent = `Service #${s.id} bearbeiten`;
    $('#service-save-btn').textContent = '✓ aktualisieren';
    $('#service-cancel-btn').style.display = 'inline-block';
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
    editingId = null;
    $('#service-form').reset();
    $('#service-form').active.checked = true;
    $('#service-form-title').textContent = 'Neuer Service';
    $('#service-save-btn').textContent = '+ speichern';
    $('#service-cancel-btn').style.display = 'none';
    $('#service-error').textContent = '';
}

async function saveService(e) {
    e.preventDefault();
    const f = e.target;
    const err = $('#service-error');
    err.textContent = '';
    const price = parseFloat(f.price_eur.value);
    if (isNaN(price) || price < 0) { err.textContent = 'Ungültiger Preis'; return; }

    const body = {
        name: f.name.value.trim(),
        description: f.description.value.trim(),
        price_cents: Math.round(price * 100),
        category: f.category.value.trim() || null,
        duration: f.duration.value.trim() || null,
        image_url: f.image_url.value.trim() || null,
        active: f.active.checked,
    };

    try {
        const url = editingId ? `/api/admin/services/${editingId}` : '/api/admin/services';
        const method = editingId ? 'PUT' : 'POST';
        const r = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Fehler');
        toast(editingId ? '✓ Aktualisiert' : '✓ Hinzugefügt', 'success');
        cancelEdit();
        loadServices();
    } catch (e) { err.textContent = '✗ ' + e.message; }
}

async function deleteService(id) {
    if (!confirm(`Service #${id} wirklich löschen?`)) return;
    const r = await fetch(`/api/admin/services/${id}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ Fehler beim Löschen', 'error');
    toast('✓ Gelöscht', 'success');
    loadServices();
}

// ============================================================
//  ORDERS
// ============================================================

async function loadOrders() {
    const r = await fetch('/api/admin/orders');
    if (!r.ok) return;
    const orders = await r.json();
    $('#orders-meta').textContent = `${orders.length} bestellungen`;
    const list = $('#orders-list');
    if (orders.length === 0) {
        list.innerHTML = '<div class="empty-state">noch keine bestellungen</div>';
        return;
    }
    list.innerHTML = orders.map(o => `
        <div class="order-card">
            <div class="head">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span class="order-id">#${String(o.id).padStart(5,'0')}</span>
                    <span class="status-badge ${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
                    <span class="status-badge ${o.payment_status === 'paid' ? 'shipped' : 'pending'}">${o.payment_status}</span>
                    <span class="crypto-tag">${escapeHtml(o.payment_currency)}</span>
                </div>
                <span class="when">${fmtDate(o.created_at)}</span>
            </div>
            <div class="customer">
                <strong>${escapeHtml(o.customer_name)}</strong> · ${escapeHtml(o.customer_email)}
                ${o.customer_phone ? ' · ' + escapeHtml(o.customer_phone) : ''}
            </div>
            ${o.notes ? `<div class="notes-block">${escapeHtml(o.notes)}</div>` : ''}
            <div class="items">
                ${o.items.map(i => `
                    <div class="item">
                        <span>${i.quantity}× ${escapeHtml(i.service_name)}</span>
                        <span>${fmt(i.unit_price_cents * i.quantity)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="addr-block">
                <span class="label">wallet:</span>
                <code>${escapeHtml(o.payment_address)}</code>
            </div>
            <div class="foot">
                <span class="total">${fmt(o.total_cents)}</span>
                <div class="order-actions">
                    <select data-pay-for="${o.id}" title="Zahlungsstatus">
                        <option value="unpaid" ${o.payment_status==='unpaid'?'selected':''}>unpaid</option>
                        <option value="paid"   ${o.payment_status==='paid'?'selected':''}>paid</option>
                    </select>
                    <select data-status-for="${o.id}" title="Bearbeitungsstatus">
                        <option value="pending"     ${o.status==='pending'?'selected':''}>pending</option>
                        <option value="in_progress" ${o.status==='in_progress'?'selected':''}>in progress</option>
                        <option value="completed"   ${o.status==='completed'?'selected':''}>completed</option>
                        <option value="cancelled"   ${o.status==='cancelled'?'selected':''}>cancelled</option>
                    </select>
                    <a href="/api/admin/orders/${o.id}/invoice.pdf"
                       target="_blank"
                       class="invoice-btn"
                       title="Rechnung als PDF">
                        📄 PDF
                    </a>
                </div>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('[data-status-for]').forEach(s => s.addEventListener('change', async e => {
        const id = parseInt(e.target.dataset.statusFor, 10);
        const r = await fetch(`/api/admin/orders/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: e.target.value }),
        });
        if (r.ok) { toast(`✓ #${id} → ${e.target.value}`, 'success'); loadOrders(); }
        else toast('✗ Fehler', 'error');
    }));

    list.querySelectorAll('[data-pay-for]').forEach(s => s.addEventListener('change', async e => {
        const id = parseInt(e.target.dataset.payFor, 10);
        const r = await fetch(`/api/admin/orders/${id}/payment`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payment_status: e.target.value }),
        });
        if (r.ok) { toast(`✓ #${id} payment → ${e.target.value}`, 'success'); loadOrders(); }
        else toast('✗ Fehler', 'error');
    }));
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    $('#login-form').addEventListener('submit', login);
    $('#logout-btn').addEventListener('click', logout);
    $('#service-form').addEventListener('submit', saveService);
    $('#service-cancel-btn').addEventListener('click', cancelEdit);
    await checkAuth();
});
