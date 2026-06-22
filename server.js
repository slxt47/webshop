// =============================================================
//  Service-Shop Server
//  - Public:   Services listen, Bestellung mit Crypto-Payment
//  - Admin:    Login (geheimer Pfad), Services CRUD, Orders verwalten,
//              Auswertung, PDF-Rechnungen
// =============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

require('dotenv').config();

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_PATH = (process.env.ADMIN_PATH || 'manage-x7k9p2').replace(/^\/+|\/+$/g, '');

const BUSINESS = {
    name:    process.env.BUSINESS_NAME || 'Mein Service',
    address: process.env.BUSINESS_ADDRESS || '',
    email:   process.env.BUSINESS_EMAIL || '',
    vat:     process.env.BUSINESS_VAT || '',
};

const CRYPTO_LABELS = {
    BTC:  'Bitcoin',
    ETH:  'Ethereum',
    USDT: 'Tether (USDT)',
    XMR:  'Monero',
    LTC:  'Litecoin',
    SOL:  'Solana',
};

function getCryptoOptions() {
    // Nur die Currencies, für die eine Adresse hinterlegt ist
    const out = [];
    for (const code of Object.keys(CRYPTO_LABELS)) {
        const addr = (process.env[`CRYPTO_${code}_ADDRESS`] || '').trim();
        if (addr) out.push({ code, label: CRYPTO_LABELS[code], address: addr });
    }
    return out;
}

// ---------- DB ----------
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'shop',
    password: process.env.DB_PASSWORD || 'shop_secret',
    database: process.env.DB_NAME || 'shopdb',
});

// ---------- Mail ----------
const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mailhog',
    port: parseInt(process.env.SMTP_PORT || '1025', 10),
    secure: false,
    auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
});

// ---------- Middleware ----------
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
const formatEUR = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

function requireAdmin(req, res, next) {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload.admin) throw new Error();
        req.admin = payload;
        next();
    } catch {
        return res.status(401).json({ error: 'Token ungültig' });
    }
}

// Beim Start: Admin-User anlegen falls nicht vorhanden
async function ensureAdmin() {
    const { rows } = await pool.query('SELECT id FROM admins WHERE username = $1', [ADMIN_USER]);
    if (rows.length === 0) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1, $2)', [ADMIN_USER, hash]);
        console.log(`[init] Admin-User "${ADMIN_USER}" angelegt.`);
    }
}

// ---------- Login Rate-Limiting (in-memory) ----------
const loginAttempts = new Map(); // ip -> { count, blockedUntil }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkLoginRate(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry) return { allowed: true };
    if (entry.blockedUntil && now < entry.blockedUntil) {
        return { allowed: false, retryInSec: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (entry.blockedUntil && now >= entry.blockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }
    return { allowed: true };
}
function registerFailedLogin(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
    entry.count++;
    if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + WINDOW_MS;
    loginAttempts.set(ip, entry);
}
function resetLoginAttempts(ip) { loginAttempts.delete(ip); }

// =============================================================
// PUBLIC API
// =============================================================

// Aktive Services
app.get('/api/services', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, description, price_cents, image_url, duration, category
             FROM services WHERE active = true ORDER BY id DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB-Fehler' });
    }
});

// Verfügbare Crypto-Optionen (nur Codes + Labels, keine Adressen)
app.get('/api/payment-options', (_req, res) => {
    res.json(getCryptoOptions().map(o => ({ code: o.code, label: o.label })));
});

// Bestellung anlegen
app.post('/api/orders', async (req, res) => {
    const { customer_name, customer_email, customer_phone, notes,
            items, payment_currency } = req.body || {};

    if (!customer_name || !customer_email || !Array.isArray(items) || items.length === 0 || !payment_currency) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
        return res.status(400).json({ error: 'Ungültige E-Mail' });
    }

    // Crypto-Option validieren
    const cryptoOptions = getCryptoOptions();
    const chosen = cryptoOptions.find(c => c.code === payment_currency);
    if (!chosen) return res.status(400).json({ error: 'Ungültige Zahlungsoption' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ids = items.map(i => parseInt(i.service_id, 10)).filter(Number.isInteger);
        if (ids.length !== items.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Ungültige Service-IDs' });
        }

        const { rows: services } = await client.query(
            `SELECT id, name, price_cents FROM services WHERE id = ANY($1::int[]) AND active = true`,
            [ids]
        );
        const map = new Map(services.map(s => [s.id, s]));

        let total = 0;
        const orderItems = [];
        for (const it of items) {
            const s = map.get(parseInt(it.service_id, 10));
            const qty = parseInt(it.quantity, 10);
            if (!s || !Number.isInteger(qty) || qty < 1) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Ungültiges Item' });
            }
            total += s.price_cents * qty;
            orderItems.push({ s, qty });
        }

        const { rows: orderRows } = await client.query(
            `INSERT INTO orders (customer_name, customer_email, customer_phone, notes,
                                 total_cents, payment_currency, payment_address)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
            [customer_name, customer_email, customer_phone || null, notes || null,
             total, chosen.code, chosen.address]
        );
        const order = orderRows[0];

        for (const { s, qty } of orderItems) {
            await client.query(
                `INSERT INTO order_items (order_id, service_id, service_name, unit_price_cents, quantity)
                 VALUES ($1,$2,$3,$4,$5)`,
                [order.id, s.id, s.name, s.price_cents, qty]
            );
        }

        await client.query('COMMIT');

        // Bestätigungsmail (Fehler hier soll Bestellung nicht killen)
        sendOrderEmail({
            order_id: order.id,
            customer_name, customer_email,
            items: orderItems.map(({ s, qty }) => ({
                name: s.name, unit_price_cents: s.price_cents, quantity: qty,
            })),
            total_cents: total,
            payment_currency: chosen.code,
            payment_label:    chosen.label,
            payment_address:  chosen.address,
            notes,
        }).catch(err => console.error('[mail] Versand fehlgeschlagen:', err.message));

        res.json({
            ok: true,
            order_id: order.id,
            total_cents: total,
            payment: {
                currency: chosen.code,
                label:    chosen.label,
                address:  chosen.address,
                reference: `Order-${order.id}`,
            },
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(err);
        res.status(500).json({ error: 'Bestellung fehlgeschlagen' });
    } finally {
        client.release();
    }
});

async function sendOrderEmail(o) {
    const itemLines = o.items
        .map(i => `  • ${i.quantity} × ${i.name}  —  ${formatEUR(i.unit_price_cents * i.quantity)}`)
        .join('\n');

    const text = `Hallo ${o.customer_name},

danke für deine Anfrage #${o.order_id}!

Gebuchte Leistungen:
${itemLines}

Gesamtbetrag: ${formatEUR(o.total_cents)}

ZAHLUNG (${o.payment_label})
─────────────────────────────────
Bitte überweise den Betrag an:
${o.payment_address}

Verwendungszweck: Order-${o.order_id}

Sobald die Zahlung eingegangen ist, melden wir uns mit den nächsten Schritten.

— ${BUSINESS.name}
${BUSINESS.email}
`;

    const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:32px;">
      <div style="max-width:560px;margin:auto;background:#111;border:1px solid #222;border-radius:12px;padding:32px;">
        <h2 style="color:#00ff88;margin:0 0 8px;font-family:'JetBrains Mono',monospace;">Anfrage #${o.order_id}</h2>
        <p style="color:#888;margin:0 0 24px;">Hallo ${escapeHtml(o.customer_name)}, danke für deine Anfrage!</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          ${o.items.map(i => `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #222;">${i.quantity} × ${escapeHtml(i.name)}</td>
              <td style="padding:8px 0;border-bottom:1px solid #222;text-align:right;font-family:monospace;">${formatEUR(i.unit_price_cents * i.quantity)}</td>
            </tr>`).join('')}
        </table>
        <div style="display:flex;justify-content:space-between;font-weight:600;font-size:18px;margin-top:16px;padding-bottom:24px;border-bottom:1px solid #222;">
          <span>Gesamt</span>
          <span style="color:#00ff88;font-family:monospace;">${formatEUR(o.total_cents)}</span>
        </div>
        <div style="margin-top:24px;padding:16px;background:#0a0a0a;border:1px solid #222;border-radius:8px;">
          <div style="color:#00ff88;font-family:monospace;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">// Zahlung — ${o.payment_label}</div>
          <div style="color:#888;font-size:13px;margin-bottom:6px;">Adresse:</div>
          <div style="font-family:monospace;font-size:13px;word-break:break-all;color:#e5e5e5;background:#000;padding:10px;border-radius:6px;">${escapeHtml(o.payment_address)}</div>
          <div style="color:#888;font-size:13px;margin-top:10px;">Referenz: <span style="font-family:monospace;color:#e5e5e5;">Order-${o.order_id}</span></div>
        </div>
        <p style="color:#666;font-size:12px;margin-top:24px;">${escapeHtml(BUSINESS.name)} · ${escapeHtml(BUSINESS.email)}</p>
      </div>
    </div>`;

    await mailer.sendMail({
        from: process.env.SMTP_FROM || 'shop@example.com',
        to: o.customer_email,
        subject: `Anfrage #${o.order_id} — Zahlungsdaten`,
        text, html,
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

// =============================================================
// ADMIN API (unter /api/admin/*)
// =============================================================

app.post('/api/admin/login', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const rate = checkLoginRate(ip);
    if (!rate.allowed) {
        return res.status(429).json({ error: `Zu viele Versuche. In ${rate.retryInSec}s erneut versuchen.` });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
        registerFailedLogin(ip);
        return res.status(400).json({ error: 'Felder fehlen' });
    }

    const { rows } = await pool.query('SELECT id, username, password_hash FROM admins WHERE username = $1', [username]);
    const admin = rows[0];
    if (!admin) {
        registerFailedLogin(ip);
        return res.status(401).json({ error: 'Login fehlgeschlagen' });
    }

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
        registerFailedLogin(ip);
        return res.status(401).json({ error: 'Login fehlgeschlagen' });
    }

    resetLoginAttempts(ip);
    const token = jwt.sign({ admin: true, id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '12h' });
    res.cookie('admin_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        // secure: true,  // einschalten wenn HTTPS aktiv
        maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
    res.clearCookie('admin_token');
    res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({ username: req.admin.username });
});

// --- Services ---
app.get('/api/admin/services', requireAdmin, async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM services ORDER BY id DESC');
    res.json(rows);
});

app.post('/api/admin/services', requireAdmin, async (req, res) => {
    const { name, description, price_cents, image_url, duration, category, active } = req.body || {};
    if (!name || !Number.isInteger(price_cents) || price_cents < 0) {
        return res.status(400).json({ error: 'Ungültige Daten' });
    }
    const { rows } = await pool.query(
        `INSERT INTO services (name, description, price_cents, image_url, duration, category, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, description || '', price_cents, image_url || null, duration || null, category || null, active !== false]
    );
    res.json(rows[0]);
});

app.put('/api/admin/services/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, description, price_cents, image_url, duration, category, active } = req.body || {};
    const { rows } = await pool.query(
        `UPDATE services
         SET name=$1, description=$2, price_cents=$3, image_url=$4, duration=$5, category=$6, active=$7
         WHERE id=$8 RETURNING *`,
        [name, description || '', price_cents, image_url || null, duration || null, category || null, active !== false, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
});

app.delete('/api/admin/services/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM services WHERE id = $1', [id]);
    res.json({ ok: true });
});

// --- Orders ---
app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
    const { rows: orders } = await pool.query(
        `SELECT id, customer_name, customer_email, customer_phone, notes, total_cents,
                payment_currency, payment_address, payment_status, status, created_at
         FROM orders ORDER BY id DESC LIMIT 500`
    );
    const ids = orders.map(o => o.id);
    let itemsByOrder = {};
    if (ids.length > 0) {
        const { rows: items } = await pool.query(
            `SELECT order_id, service_name, unit_price_cents, quantity
             FROM order_items WHERE order_id = ANY($1::int[])`,
            [ids]
        );
        for (const it of items) (itemsByOrder[it.order_id] ||= []).push(it);
    }
    res.json(orders.map(o => ({ ...o, items: itemsByOrder[o.id] || [] })));
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Ungültiger Status' });
    }
    const { rows } = await pool.query(
        'UPDATE orders SET status=$1 WHERE id=$2 RETURNING id, status', [status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
});

app.put('/api/admin/orders/:id/payment', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { payment_status } = req.body || {};
    if (!['unpaid', 'paid'].includes(payment_status)) {
        return res.status(400).json({ error: 'Ungültiger Zahlungsstatus' });
    }
    const { rows } = await pool.query(
        'UPDATE orders SET payment_status=$1 WHERE id=$2 RETURNING id, payment_status', [payment_status, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
});

// --- Analytics ---
app.get('/api/admin/analytics', requireAdmin, async (_req, res) => {
    try {
        const [total, byStatus, byPay, last14, topServices, recent] = await Promise.all([
            pool.query(`SELECT
                COUNT(*)::int                                                          AS total_orders,
                COALESCE(SUM(total_cents) FILTER (WHERE payment_status='paid'),0)::int AS paid_revenue,
                COALESCE(SUM(total_cents) FILTER (WHERE payment_status='unpaid'),0)::int AS unpaid_revenue,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int   AS orders_30d,
                COALESCE(SUM(total_cents) FILTER (WHERE payment_status='paid' AND created_at > now() - interval '30 days'),0)::int AS revenue_30d
              FROM orders`),
            pool.query(`SELECT status, COUNT(*)::int AS c FROM orders GROUP BY status`),
            pool.query(`SELECT payment_currency AS code, COUNT(*)::int AS c,
                               COALESCE(SUM(total_cents) FILTER (WHERE payment_status='paid'),0)::int AS revenue
                        FROM orders GROUP BY payment_currency ORDER BY c DESC`),
            pool.query(`SELECT to_char(d::date,'YYYY-MM-DD') AS day,
                               COALESCE(SUM(o.total_cents) FILTER (WHERE o.payment_status='paid'),0)::int AS revenue,
                               COUNT(o.id)::int AS orders
                        FROM generate_series(now()::date - interval '13 days', now()::date, '1 day') d
                        LEFT JOIN orders o ON o.created_at::date = d::date
                        GROUP BY d ORDER BY d`),
            pool.query(`SELECT service_name, SUM(quantity)::int AS qty,
                               SUM(unit_price_cents * quantity)::int AS revenue
                        FROM order_items GROUP BY service_name ORDER BY revenue DESC LIMIT 5`),
            pool.query(`SELECT id, customer_name, total_cents, payment_status, status, created_at
                        FROM orders ORDER BY id DESC LIMIT 5`),
        ]);

        res.json({
            stats: total.rows[0],
            by_status: byStatus.rows,
            by_payment: byPay.rows,
            chart_14d: last14.rows,
            top_services: topServices.rows,
            recent: recent.rows,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Analytics fehlgeschlagen' });
    }
});

// --- PDF-Rechnung ---
app.get('/api/admin/orders/:id/invoice.pdf', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rows: orders } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orders.length === 0) return res.status(404).send('Nicht gefunden');
    const order = orders[0];
    const { rows: items } = await pool.query(
        'SELECT service_name, unit_price_cents, quantity FROM order_items WHERE order_id = $1', [id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rechnung-${id}.pdf"`);

    generateInvoicePdf(res, order, items);
});

function generateInvoicePdf(stream, order, items) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(stream);

    const ACCENT = '#00aa66';
    const DARK = '#1a1a1a';
    const MUTED = '#888888';

    // Header
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(22).text(BUSINESS.name, 50, 50);
    if (BUSINESS.address) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(BUSINESS.address, 50, 78);
    if (BUSINESS.email)   doc.text(BUSINESS.email, 50, 92);
    if (BUSINESS.vat)     doc.text(`USt-IdNr.: ${BUSINESS.vat}`, 50, 106);

    // Rechnungsblock rechts
    doc.font('Helvetica-Bold').fontSize(28).fillColor(ACCENT).text('RECHNUNG', 350, 50, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(DARK)
       .text(`Rechnungsnr.:  R-${String(order.id).padStart(5, '0')}`, 350, 88, { align: 'right' })
       .text(`Datum:         ${new Date(order.created_at).toLocaleDateString('de-DE')}`, 350, 102, { align: 'right' });

    // Trennlinie
    doc.strokeColor('#dddddd').lineWidth(1).moveTo(50, 140).lineTo(545, 140).stroke();

    // Empfänger
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text('RECHNUNG AN', 50, 160);
    doc.font('Helvetica').fontSize(11).fillColor(DARK).text(order.customer_name, 50, 175);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(order.customer_email, 50, 190);
    if (order.customer_phone) doc.text(order.customer_phone, 50, 204);

    // Items-Tabelle
    let y = 250;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('LEISTUNG', 50, y);
    doc.text('MENGE', 320, y, { width: 60, align: 'right' });
    doc.text('EINZELPREIS', 380, y, { width: 80, align: 'right' });
    doc.text('SUMME', 460, y, { width: 85, align: 'right' });
    y += 14;
    doc.strokeColor('#dddddd').moveTo(50, y).lineTo(545, y).stroke();
    y += 10;

    doc.font('Helvetica').fontSize(10).fillColor(DARK);
    for (const it of items) {
        const lineTotal = it.unit_price_cents * it.quantity;
        doc.text(it.service_name, 50, y, { width: 260 });
        doc.text(String(it.quantity), 320, y, { width: 60, align: 'right' });
        doc.text(formatEUR(it.unit_price_cents), 380, y, { width: 80, align: 'right' });
        doc.text(formatEUR(lineTotal), 460, y, { width: 85, align: 'right' });
        y += 22;
    }

    // Summen
    y += 10;
    doc.strokeColor('#dddddd').moveTo(320, y).lineTo(545, y).stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(DARK).text('Gesamt', 320, y, { width: 140, align: 'right' });
    doc.fillColor(ACCENT).text(formatEUR(order.total_cents), 460, y, { width: 85, align: 'right' });

    // Zahlung
    y += 50;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text('ZAHLUNGSDATEN', 50, y);
    y += 14;
    doc.font('Helvetica').fontSize(10).fillColor(DARK)
       .text(`Methode:    ${CRYPTO_LABELS[order.payment_currency] || order.payment_currency}`, 50, y);
    y += 14;
    doc.text(`Adresse:    ${order.payment_address}`, 50, y, { width: 495 });
    y += 28;
    doc.text(`Referenz:   Order-${order.id}`, 50, y);
    y += 14;
    doc.fillColor(order.payment_status === 'paid' ? ACCENT : '#cc6600')
       .font('Helvetica-Bold')
       .text(`Status:     ${order.payment_status === 'paid' ? 'BEZAHLT' : 'OFFEN'}`, 50, y);

    // Notizen
    if (order.notes) {
        y += 36;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text('ANMERKUNGEN', 50, y);
        y += 14;
        doc.font('Helvetica').fontSize(10).fillColor(DARK).text(order.notes, 50, y, { width: 495 });
    }

    // Footer
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
       .text(`${BUSINESS.name}  ·  ${BUSINESS.email}`, 50, 780, { width: 495, align: 'center' });

    doc.end();
}

// =============================================================
// SEITEN-ROUTEN
// =============================================================

// Shop
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Konfigurations-Endpoint für Frontend (Business-Name etc.)
app.get('/api/config', (_req, res) => {
    res.json({
        business_name: BUSINESS.name,
        business_email: BUSINESS.email,
    });
});

// Admin nur unter geheimem Pfad erreichbar
app.get('/' + ADMIN_PATH, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Wenn jemand /admin direkt aufruft -> 404 (so existiert der Pfad scheinbar nicht)
app.get(['/admin', '/administrator', '/wp-admin', '/admin.php'], (_req, res) => {
    res.status(404).send('Not Found');
});

// =============================================================
// START
// =============================================================

(async () => {
    let tries = 0;
    while (true) {
        try { await pool.query('SELECT 1'); break; }
        catch (e) {
            if (++tries > 30) throw e;
            console.log('[init] warte auf DB...');
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    await ensureAdmin();

    const cryptoCount = getCryptoOptions().length;
    app.listen(PORT, () => {
        console.log(`[ready] Shop läuft auf http://localhost:${PORT}`);
        console.log(`[ready] Admin unter http://localhost:${PORT}/${ADMIN_PATH}`);
        console.log(`[ready] ${cryptoCount} Crypto-Option(en) konfiguriert`);
        if (cryptoCount === 0) {
            console.log('[warn]  Keine Crypto-Adresse hinterlegt! In .env mindestens eine CRYPTO_*_ADDRESS setzen.');
        }
    });
})().catch(err => {
    console.error('Start fehlgeschlagen:', err);
    process.exit(1);
});
