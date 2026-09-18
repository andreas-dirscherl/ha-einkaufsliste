# 🛒 Einkaufsliste - Ultra-schnelle PWA mit Home Assistant Integration

Eine extrem schnelle, offline-fähige Einkaufslisten-App, die sich in Echtzeit mit den `todo`-Listen von Home Assistant synchronisiert. Perfekt für die Nutzung im Supermarkt mit oder ohne Internetverbindung.

## ✨ Features

- ⚡ **Ultra-schnell**: Minimalistisches Design, optimiert für schnellste Ladezeiten
- 🌐 **Progressive Web App (PWA)**: Installierbar auf dem Smartphone-Startbildschirm
- 📱 **Offline-Modus**: Funktioniert vollständig offline, synchronisiert automatisch wenn das Netz zurück ist
- 🏠 **Home Assistant Integration**: Direkte Synchronisation mit HA-todo-Listen
- 👥 **Multi-User**: Admin kann weitere Benutzer anlegen und Berechtigungen verwalten
- 🔒 **Sicher**: Passwörter mit bcrypt gehashed, HA-Token verschlüsselt (AES-256), JWT-Sessions
- 🐳 **Docker-ready**: Optimierter Multi-Stage-Build für Unraid
- 💾 **SQLite DB**: Lokal gespeichert, keine Cloud nötig
- 🎯 **Smart Duplicate Management**: Wiederaktiviert automatisch erledigte Items statt Duplikate zu erstellen

## 🚀 Schnellstart

### Lokal starten (Entwicklung)

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Server starten
npm run dev

# 3. Browser öffnen
# http://localhost:3000/setup.html
```

### Mit Docker

```bash
# Bauen
docker build -t ha-shopping-list .

# Starten
docker run -p 3000:3000 -v data:/app/data ha-shopping-list
```

### Mit docker-compose

```bash
docker-compose up -d
```

## 🔧 Projektstruktur

```
ha-einkaufsliste/
├── backend/
│   ├── server.js          # Express Server mit API Routes
│   └── database.js        # SQLite DB, Schema & Krypto-Funktionen
├── frontend/
│   ├── index.html         # Main App (mit Tailwind CSS)
│   ├── setup.html         # Setup Wizard
│   ├── manifest.json      # PWA Manifest
│   └── sw.js              # Service Worker (Offline + Caching)
├── assets/
│   ├── icon-192.svg       # PWA Icon (192x192)
│   ├── icon-512.svg       # PWA Icon (512x512)
│   └── icon-*-maskable.sv # Maskable Icons für Android
├── Dockerfile             # Multi-Stage Build
├── docker-compose.yml     # Docker Compose Config
├── package.json           # Node Dependencies
└── README.md             # Diese Datei
```

## 📋 Konfiguration

### Erste Einrichtung (Setup Wizard)

1. App öffnen → `/setup.html` wird automatisch angezeigt
2. **Admin-Account erstellen**: Username + Passwort (min. 8 Zeichen)
3. **Home Assistant verbinden**:
   - Home Assistant URL eingeben (z.B. `https://192.168.1.100:8123`)
   - Langlebiger Zugriffstoken eintragen (von HA: Profil → Sicherheit → Langlebige Tokens)
4. **Verbindung testen** - `🧪 Verbindung testen` Button
5. **Setup abschließen** - `✅ Setup abschließen`

**Wichtig**: Die Setup-Seite ist nach der ersten Einrichtung dauerhaft gesperrt! Der HA-Token wird verschlüsselt in der Datenbank gespeichert.

### Umgebungsvariablen

Kopiere `.env.example` zu `.env` und passe die Werte an:

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=your-secret-key-here
DB_PATH=/app/data/app.db
```

## 🔐 Sicherheit

- **Passwort-Hashing**: bcryptjs mit Salt
- **Token-Verschlüsselung**: AES-256 für HA-Token in der DB
- **JWT-Sessions**: 30 Tage Gültigkeit, HTTP-only Cookies geplant
- **CORS**: Konfiguriert für sichere Cross-Origin Requests
- **Datenbank**: `PRAGMA foreign_keys = ON` für referenzielle Integrität

## 📚 API-Dokumentation

### Setup
- `GET /api/setup/status` - Prüft ob Setup komplett ist
- `POST /api/setup/init` - Initialisiert Setup (Admin + HA-Config)

### Authentication
- `POST /api/auth/login` - Login mit Username/Passwort

### Listen (To-Do)
- `GET /api/lists` - Alle Listen des aktuellen Users
- `GET /api/lists/:id` - Liste mit Items laden

### Items (Artikel)
- `POST /api/lists/:listId/items` - Neuen Artikel hinzufügen
- `PATCH /api/items/:itemId` - Item als erledigt markieren/abhaken
- `DELETE /api/items/:itemId` - Item löschen

### Health
- `GET /api/health` - Server Liveness Check

## 🌐 PWA Installation

### iOS (Safari)
1. App öffnen
2. Teilen (Share) → "Auf dem Home-Bildschirm"

### Android (Chrome)
1. App öffnen
2. Menu (3 Punkte) → "Installieren"
3. Oder automatisches Banner wenn App genug genutzt wird

## 📡 Offline Synchronisation

Die App funktioniert vollständig offline:

1. **Offline**: Änderungen werden lokal in IndexedDB gespeichert
2. **Online-Rückkehr**: Service Worker ruft `sync-offline-requests` auf
3. **Background Sync**: Alle gepufferten Changes werden zum Server gesendet
4. **Konflikt-Auflösung**: Aktuelle Daten von HA gelten als "Single Source of Truth"

## 🤖 Smart Duplicate Management

**Szenario**: Du fügst "Mehl" hinzu, aber "Mehl" existiert bereits als ERLEDIGT in der HA-Liste.

**Verhalten**: Statt ein Duplikat zu erstellen, wird das alte "Mehl" automatisch wieder als NICHT ERLEDIGT markiert.

**Implementierung**:
```javascript
// In POST /api/lists/:listId/items
const existingItem = db.prepare(`
  SELECT * FROM items
  WHERE list_id = ? AND LOWER(title) = LOWER(?) AND is_completed = 1
`).get(listId, title);

if (existingItem) {
  // Reaktivieren statt neuen eintrag
  db.prepare('UPDATE items SET is_completed = 0 WHERE id = ?').run(existingItem.id);
}
```

## 🚢 Deployment auf Unraid

### Docker Image Vorbereitung

```bash
# Image bauen und pushen zu Docker Registry
docker build -t yourusername/ha-shopping-list:latest .
docker push yourusername/ha-shopping-list:latest
```

### Unraid Konfiguration

1. **Im Unraid Web UI**: Apps → Dockerapps suchen
2. Oder manuell im Terminal:

```bash
docker run -d \
  --name ha-shopping-list \
  -p 3000:3000 \
  -v /mnt/user/appdata/ha-shopping-list/data:/app/data \
  --restart unless-stopped \
  yourusername/ha-shopping-list:latest
```

3. **Netzwerk-Konfiguration**: 
   - Port 3000 an beliebigen Host-Port mappen (z.B. 8080)
   - Automatischer Redirect von lokal zu Unraid IP

## 📦 Dependencies

### Backend
- **express**: Web Framework
- **better-sqlite3**: Schnelle SQLite DB
- **bcryptjs**: Passwort-Hashing
- **jsonwebtoken**: JWT Auth
- **cors**: Cross-Origin Requests
- **axios**: HTTP Client
- **dotenv**: Environment Vars

### Frontend
- **Tailwind CSS** (CDN): Utility-first CSS Framework
- **Service Worker**: Native API für Offline + Caching
- **Fetch API**: Native HTTP
- **IndexedDB**: Native Browser-Datenbank für Offline-Sync

## 🐛 Debugging

### Service Worker Inspector
- Chrome DevTools → Application → Service Workers
- Alle Cache-Versionen sichtbar: `einkaufsliste-v1`, `einkaufsliste-api-v1`

### SQLite Inspektion
```bash
sqlite3 data/app.db
sqlite> .schema                    # Alle Tables anzeigen
sqlite> SELECT * FROM users;      # Users checken
sqlite> SELECT * FROM config;     # HA-Config checken
```

### Logs
```bash
# Server Logs (Docker)
docker logs -f ha-shopping-list

# Browser Console
F12 → Console Tab
```

## 📋 TODO / Geplante Features

- [ ] Home Assistant WebSocket Integration (Live Push statt Polling)
- [ ] Kategorien für Items (Obst, Gemüse, etc.)
- [ ] Einkaufslisten-Templates
- [ ] Preis-Tracking
- [ ] Push Notifications auf dem Smartphone
- [ ] Dunkler Modus
- [ ] Multi-Sprachen Support
- [ ] Admin Dashboard für User Management
- [ ] Liste als QR-Code teilen

## 📄 Lizenz

MIT

## 👨‍💻 Support

Für Fragen oder Bugs: Erstelle ein Issue auf GitHub.

---

**Viel Erfolg beim Einkaufen!** 🛒
