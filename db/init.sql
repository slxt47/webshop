-- =============================================================
-- Schema für Dienstleistungs-Shop mit Crypto-Payment
-- =============================================================

CREATE TABLE IF NOT EXISTS services (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    image_url   TEXT,
    duration    VARCHAR(100),       -- z.B. "30 min", "ab 2 Tagen", "pro Projekt"
    category    VARCHAR(100),
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(80) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id               SERIAL PRIMARY KEY,
    customer_name    VARCHAR(200) NOT NULL,
    customer_email   VARCHAR(200) NOT NULL,
    customer_phone   VARCHAR(50),
    notes            TEXT,                                       -- Details/Anmerkungen vom Kunden
    total_cents      INTEGER NOT NULL,
    payment_currency VARCHAR(20) NOT NULL,                       -- BTC, ETH, USDT, XMR, LTC ...
    payment_address  TEXT NOT NULL,                              -- Wallet-Adresse zum Zeitpunkt der Order
    payment_status   VARCHAR(40) NOT NULL DEFAULT 'unpaid',      -- unpaid | paid
    status           VARCHAR(40) NOT NULL DEFAULT 'pending',     -- pending | in_progress | completed | cancelled
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    id               SERIAL PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    service_id       INTEGER REFERENCES services(id) ON DELETE SET NULL,
    service_name     VARCHAR(200) NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders (payment_status);
