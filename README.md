# Service Shop — Dienstleistungen mit Crypto-Payment

Online-Shop für **Dienstleistungen** (keine physischen Produkte) mit Crypto-Bezahlung,
Admin-Panel auf geheimer URL, Auswertungs-Dashboard und PDF-Rechnungen.
Alles in **einem Befehl** via Docker startbar.

## Stack

- **Backend:** Node.js (Express) + JWT-Auth + Login-Rate-Limiting
- **Datenbank:** PostgreSQL 16
- **PDF:** PDFKit (Rechnungs-Generierung)
- **E-Mail:** Nodemailer + Mailpit (fängt Test-Mails ab)
- **Frontend:** Vanilla HTML/CSS/JS, Dark-Tech-Theme

## Schnellstart

```bash
cp .env.example .env
# .env editieren — Crypto-Adressen, Admin-Passwort, JWT_SECRET, ADMIN_PATH
docker compose up -d --build
```

## URLs

| URL                                 | Zweck                              |
|-------------------------------------|------------------------------------|
| http://localhost:3000               | Shop / Service-Buchung             |
| http://localhost:3000/{ADMIN_PATH}  | Admin-Panel (geheime URL!)         |
| http://localhost:8025               | Mailpit — gesendete E-Mails ansehen |

`ADMIN_PATH` aus `.env`. Mit `NODE_ENV=production` (Standard in der `docker-compose.yml`) **startet der Shop nicht**, solange `JWT_SECRET`, `ADMIN_PASSWORD` oder `ADMIN_PATH` auf den Beispielwerten stehen.
Wenn jemand `/admin` aufruft kommt 404 — der Pfad existiert scheinbar gar nicht.

## Features

### Public Shop (`/`)
- Service-Katalog mit Kategorie + Aufwand pro Service
- Buchungs-Drawer (Mehrfachauswahl, Mengen)
- Checkout mit Name, E-Mail, Telefon (optional), **freitext-Anmerkungen**
- **Crypto-Auswahl** je nach konfigurierten Wallets (BTC / ETH / USDT / XMR / LTC / SOL)
- Nach Buchung: Wallet-Adresse + Betrag + Referenz angezeigt + per Mail
- Copy-Button für die Adresse

### Admin (`/{ADMIN_PATH}`)
Drei Tabs:

1. **Auswertung** (Standard-Tab)
   - 4 Stat-Cards: bezahlter Umsatz, offene Zahlungen, Anzahl Bestellungen, Durchschnittswert
   - Umsatz-Chart (letzte 14 Tage, SVG, hoverbar)
   - Top-Services Ranking
   - Status- und Zahlungsmethoden-Verteilung
   - Letzte 5 Bestellungen
2. **Services** — CRUD für deine Leistungen (Kategorie, Aufwand, sichtbar/versteckt)
3. **Bestellungen** — Liste mit Items + Anmerkungen + Wallet, Status-Wechsel,
   Zahlungsstatus, **PDF-Rechnung-Download** pro Bestellung

### Sicherheit
- Geheimer URL-Pfad fürs Admin-Panel (`ADMIN_PATH`)
- Rate-Limit: max. 5 Login-Versuche / 15 Min pro IP
- JWT in HttpOnly-Cookie (12h Gültigkeit)
- bcrypt für Passwort-Hashes

### PDF-Rechnungen
Klick auf 📄 PDF in einer Bestellung → fertige A4-Rechnung mit:
Geschäftsdaten, Kunde, Leistungsposten, Summe, Crypto-Zahlungsdaten, Anmerkungen.

## Konfiguration (.env)

### Crypto-Wallets
Trag nur die Currencies ein, die du akzeptierst. Leere Felder werden im Shop nicht angeboten.

```env
CRYPTO_BTC_ADDRESS=bc1q...
CRYPTO_ETH_ADDRESS=0x...
CRYPTO_USDT_ADDRESS=0x...     # USDT auf ERC-20 (Ethereum)
CRYPTO_XMR_ADDRESS=4...
CRYPTO_LTC_ADDRESS=ltc1...
CRYPTO_SOL_ADDRESS=...
```

> ⚠️ Empfohlen: pro Bestellung manuell prüfen ob die Zahlung eingegangen ist
> (Block-Explorer / Wallet) und dann im Admin auf `paid` setzen.
> Auto-Bestätigung via Block-Explorer-API kann später ergänzt werden.

### Geschäftsdaten (für Rechnung + Footer)
```env
BUSINESS_NAME=Mein Service GmbH
BUSINESS_ADDRESS=Musterstr. 1, 12345 Musterstadt
BUSINESS_EMAIL=kontakt@example.com
BUSINESS_VAT=DE123456789       # optional, für Rechnung
```

### E-Mail
Default geht an Mailhog (sichtbar auf :8025). Für echten Versand:
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxx...
SMTP_FROM=noreply@deine-domain.de
```

## Produktiv-Einsatz

Vor dem Online-Stellen unbedingt:

1. `.env` editieren, **alle Defaults ersetzen**:
   - `ADMIN_USER` / `ADMIN_PASSWORD`
   - `JWT_SECRET` → mit `openssl rand -hex 32` erzeugen
   - `ADMIN_PATH` → eigener geheimer String
2. Das Login-Cookie ist in Produktion automatisch `secure` (nur über HTTPS). Lokal ohne HTTPS: `COOKIE_SECURE=false` setzen
3. Hinter Reverse-Proxy mit HTTPS stellen (Caddy, nginx, Traefik …)
4. Echten SMTP-Provider statt Mailhog
5. Postgres-Backups einrichten (z.B. `pg_dump` im Cron)

## Häufige Befehle

```bash
docker compose up -d --build       # Starten / neu bauen
docker compose down                # Stoppen
docker compose down -v             # Stoppen + DB-Daten löschen (Reset)
docker compose logs -f app         # App-Logs
docker compose exec db psql -U shop shopdb     # In die DB
```

## Projekt-Struktur

```
shop/
├── docker-compose.yml      Orchestriert app + db + mailhog
├── Dockerfile              Node-Image
├── .env.example            Vorlage für Konfiguration
├── package.json
├── server.js               Express + alle API-Routen + PDF
├── db/
│   └── init.sql            Schema + Beispiel-Services
└── public/
    ├── index.html          Shop
    ├── admin.html          Admin (Login + Dashboard)
    ├── css/style.css
    └── js/
        ├── shop.js
        └── admin.js
```

## Änderungen (Oktober 2026)

- **`.gitignore` ergänzt.** Es fehlte, dadurch war früher eine echte `.env` im Repo
  (inzwischen gelöscht, steht aber noch in der Git-Historie, die Werte sind ausgetauscht).
- In Produktion verweigert der Server den Start mit Standard-Zugangsdaten
  (`admin123`, `dev-only-secret`, `manage-x7k9p2`).
- Login-Cookie in Produktion nur über HTTPS (`COOKIE_SECURE`).
- Port nur auf `127.0.0.1`, davor gehört ein Reverse-Proxy oder Tunnel mit HTTPS.
- Fehler behoben: README und `.env.example` versprachen Mailhog, die Compose-Datei startete aber keinen
  Mail-Dienst. Jetzt läuft **Mailpit** (auch unter dem Namen `mailhog` erreichbar).

