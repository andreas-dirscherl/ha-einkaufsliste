# Einkaufsliste - Progressive Web App mit Home Assistant Integration

Eine hochperformante, offline-fähige Einkaufslisten-Anwendung mit nahtloser Synchronisation zu Home Assistant Todo-Listen. Die Anwendung wurde für schnellste Reaktionszeiten und Zuverlässigkeit auch ohne Internetverbindung optimiert.

## Features

- **Progressive Web App (PWA)**: Installation auf dem Smartphone-Startbildschirm
- **Offline-Funktionalität**: Vollständige Funktionalität ohne Internetverbindung mit automatischer Synchronisation
- **Home Assistant Integration**: Direkte Synchronisation mit HA-Todo-Listen
- **Multi-User Management**: Administratorverwaltete Benutzer mit granularer Zugriffskontrolle
- **Zwei-Faktor-Authentifizierung (2FA)**: TOTP-basiert mit QR-Code und Backup-Codes
- **Admin Dashboard**: Umfassende Verwaltungsoberfläche für Benutzer, Kategorien, Listen und Berechtigungen
- **Verschlüsselte Speicherung**: AES-256-Verschlüsselung für sensitive Daten
- **JWT-basierte Authentifizierung**: Sichere Session-Verwaltung mit 30-Tage Rolling-Windows
- **SQLite-Datenspeicherung**: Lokal gespeichert, keine Cloud-Abhängigkeit
- **Docker-optimiert**: Multi-Stage Build für Unraid und andere Docker-Umgebungen
- **Responsive Design**: Optimiert für Desktop, Tablet und Mobile Geräte
- **Light/Dark Mode**: Systemthema-Erkennung mit manueller Übersteuerung
- **Smart Duplicate Management**: Reaktiviert automatisch abgeschlossene Items statt Duplikate zu erstellen

## Installation

### Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Server mit Hot-Reload starten
npm run dev

# Browser öffnen
# http://localhost:3000/setup.html
```

### Docker

```bash
# Image bauen
docker build -t ha-shopping-list .

# Container starten
docker run -d \
  --name ha-shopping-list \
  -p 3000:3000 \
  -v ha-shopping-data:/app/data \
  --restart unless-stopped \
  ha-shopping-list
```

### Docker Compose

```bash
docker-compose up -d
```

## Projektstruktur

```
ha-einkaufsliste/
├── backend/
│   ├── server.js              # Express Server, API Routes
│   ├── database.js            # SQLite Schema, Migrationen, Verschlüsselung
│   ├── websocket-server.js    # WebSocket für Echtzeit-Updates
│   ├── ha-integration.js      # Home Assistant REST API Integration
│   ├── ha-polling.js          # HA Liste-Polling
│   ├── ha-person-polling.js   # HA Person-Standort-Polling
│   ├── sync-manager.js        # Offline-Sync-Verwaltung
│   └── categories.js          # Kategorien-Logik
├── frontend/
│   ├── index.html             # Hauptanwendung (mit CSS Design-System)
│   ├── admin.html             # Admin Dashboard
│   ├── setup.html             # Setup-Assistent
│   ├── style.css              # Unified Design System mit CSS-Variablen
│   ├── manifest.json          # PWA Manifest
│   └── sw.js                  # Service Worker (Offline + Caching)
├── assets/
│   └── [PWA Icons]
├── Dockerfile                 # Multi-Stage Build
├── docker-compose.yml         # Compose Konfiguration
├── package.json               # Node.js Dependencies
└── README.md                  # Diese Datei
```

## Konfiguration

### Erste Einrichtung

1. Anwendung öffnen -> Automatische Umleitung zu /setup.html
2. Admin-Konto erstellen (Benutzername und Passwort, Mindestens 8 Zeichen)
3. Home Assistant Verbindung konfigurieren:
   - HA-URL eingeben (z.B. https://192.168.1.100:8123)
   - Langlebigen Zugriffstoken von Home Assistant eintragen
4. Verbindung testen
5. Setup abschließen

Die Setup-Seite ist nach der Initialisierung dauerhaft geschützt. Der HA-Token wird verschlüsselt in der Datenbank gespeichert.

### Umgebungsvariablen

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=<random-secret-key>
DB_PATH=/app/data/app.db
```

## Sicherheit

- **Passwort-Hashing**: bcryptjs mit konfigurierbarem Salt-Rounds
- **Token-Verschlüsselung**: AES-256-GCM für Home Assistant Tokens
- **JWT-Sessions**: 30-Tage Rolling-Window mit automatischer Erneuerung
- **Zwei-Faktor-Authentifizierung**: TOTP (RFC 6238) mit Backup-Codes
- **CORS-Konfiguration**: Restriktiv konfiguriert
- **Referenzielle Integrität**: SQLite Foreign Keys aktiviert
- **Eingabe-Validierung**: Alle API-Eingaben werden validiert und sanitiert

## API-Dokumentation

### Authentifizierung
- `POST /api/auth/login` - Benutzer-Login
- `POST /api/auth/logout` - Benutzer-Logout

### Setup
- `GET /api/setup/status` - Überprüft Setup-Status
- `POST /api/setup/init` - Setup initialisieren

### Benutzerverwaltung
- `GET /api/user/2fa-status` - Aktuellen 2FA-Status abrufen
- `POST /api/user/2fa-initiate` - 2FA-Setup initiieren
- `POST /api/user/2fa-verify` - 2FA-Code verifizieren
- `DELETE /api/user/2fa` - 2FA deaktivieren
- `PATCH /api/user/profile` - Profildetails aktualisieren

### Listen
- `GET /api/lists` - Alle Listen des aktuellen Benutzers
- `GET /api/lists/:id` - Liste mit allen Items laden
- `POST /api/lists/:id/items` - Neues Item hinzufügen
- `PATCH /api/items/:itemId` - Item aktualisieren (Status, Name)
- `DELETE /api/items/:itemId` - Item löschen

### Admin
- `GET /api/admin/users` - Alle Benutzer (Admin nur)
- `POST /api/admin/users` - Neuen Benutzer erstellen (Admin nur)
- `DELETE /api/admin/users/:id` - Benutzer löschen (Admin nur)
- `GET /api/admin/categories` - Alle Kategorien
- `POST /api/admin/categories` - Neue Kategorie erstellen (Admin nur)

### Health
- `GET /api/health` - Server-Liveness Check

## PWA-Installation

### iOS (Safari)
1. Anwendung öffnen
2. Teilen (Share-Button) -> "Auf dem Home-Bildschirm"

### Android (Chrome)
1. Anwendung öffnen
2. Menü (drei Punkte) -> "App installieren"

## Offline-Synchronisation

Die Anwendung funktioniert vollständig offline mit automatischer Synchronisation:

1. **Offline-Modus**: Änderungen werden lokal in IndexedDB gepuffert
2. **Online-Wiederherstellung**: Service Worker erkennt Netzwerkwiederverbindung
3. **Background Sync**: Gepufferte Änderungen werden zum Server übertragen
4. **Konfliktauflösung**: Server-Daten gelten als autorisierte Quelle

## Admin Dashboard

Das Admin Dashboard bietet umfassende Verwaltungsfunktionen:

- **Benutzer**: Anlegen, Bearbeiten, Löschen, Home Assistant-Person Zuordnung
- **Kategorien**: Verwaltung von Artikelkategorien
- **Listen**: Übersicht aller Listen und deren Inhalte
- **Berechtigungen**: Granulare Kontrolle von Benutzer-Listen-Zugriff
- **Synchronisierung**: Manuelles Trigger von HA-Synchronisation
- **Home Assistant**: Konfiguration von HA-Verbindungsparametern

## Deployment auf Unraid

```bash
docker run -d \
  --name ha-shopping-list \
  -p 3000:3000 \
  -v /mnt/user/appdata/ha-shopping-list/data:/app/data \
  --restart unless-stopped \
  ha-shopping-list:latest
```

## Dependencies

### Backend
- express: Web Framework
- better-sqlite3: SQLite Datenbank
- bcryptjs: Password Hashing
- jsonwebtoken: JWT Authentication
- speakeasy: TOTP Implementation
- qrcode: QR-Code Generierung
- cors: Cross-Origin Resource Sharing
- dotenv: Environment Variables
- ws: WebSocket Server

### Frontend
- CSS Custom Properties: Design System
- Service Worker API: Offline Support
- Fetch API: HTTP Client
- IndexedDB: Local Storage
- WebSocket API: Echtzeit-Updates

## Debugging

### Service Worker
Chrome DevTools -> Application -> Service Workers

### SQLite-Datenspeicherung
```bash
sqlite3 data/app.db
.schema                    # Datenbankschema anzeigen
SELECT * FROM users;      # Benutzer anzeigen
SELECT * FROM config;     # Konfiguration anzeigen
```

### Server-Logs
```bash
docker logs -f ha-shopping-list
```

### Browser-Konsole
F12 -> Console Tab

## Troubleshooting

### Port bereits in Verwendung
```bash
# Port freigeben (Windows)
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Oder anderen Port verwenden
PORT=3001 npm run dev
```

### Datenbankprobleme
```bash
# Datenbankdatei löschen (alle Daten gehen verloren)
rm data/app.db
# Oder im Docker:
docker exec ha-shopping-list rm /app/data/app.db
```

### Service Worker nicht aktualisiert
- Browser Cache leeren: Ctrl+Shift+Delete
- Oder DevTools -> Application -> Service Workers -> Unregister

## Performance-Optimierungen

- Minimierte CSS und JavaScript
- Aggressive Caching-Strategien (Cache-First für Assets, Network-First für API)
- SQLite PRAGMA-Optimierungen
- Connection Pooling (besser-sqlite3)
- Gzip-Kompression für HTTP-Responses

## Geplante Features

- WebSocket-basierte Echtzeit-Synchronisation (statt Polling)
- Erweiterte Kategorien-Verwaltung
- Einkaufslisten-Templates
- Preis-Tracking und Budgetierung
- Push-Benachrichtigungen auf Mobilgeräten
- Multi-Sprachen-Support
- Erweiterte Suchfunktionen
- Einkaufslisten als QR-Code teilen
- Mobile App (React Native)

## Lizenzen

MIT

---

Für Fragen oder Bugs: Erstellen Sie ein Issue auf GitHub.
