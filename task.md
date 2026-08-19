# Affiliate System – Aufgaben

## Backend (Cloudflare Worker – index.ts)
- [x] Firestore-Operationen für `affiliates` Collection
- [x] `POST /api/affiliate/register` – Registrierung
- [x] `POST /api/affiliate/login` – Magic-Link Login
- [x] `GET /api/affiliate/dashboard` – Dashboard-Daten
- [x] `POST /api/affiliate/request-payout` – Auszahlung beantragen
- [x] `POST /api/affiliate/validate-code` – Code validieren
- [x] `POST /api/admin/affiliates` – Alle Affiliates (Admin)
- [x] `POST /api/admin/mark-paid` – Auszahlung markieren (Admin)
- [x] Bestehende Endpunkte anpassen: `create-order` + `capture-order`
- [x] E-Mail-Templates für Affiliate-System

## Frontend – pricing.html
- [x] Rabatt-Code Eingabefeld
- [x] Echtzeit Code-Validierung
- [x] Dynamische Preisanzeige mit Rabatt
- [x] Integration mit create-order Endpunkt

## Frontend – affiliate.html (NEU)
- [x] Registrierungs-Formular
- [x] Login-Bereich (Magic Link)
- [x] Dashboard mit Code, Balance, Statistiken
- [x] Auszahlungsanfrage
- [x] Admin-Bereich (versteckt)

## Verifizierung
- [x] Alle Endpunkte testen
- [x] Sicherheits-Check
