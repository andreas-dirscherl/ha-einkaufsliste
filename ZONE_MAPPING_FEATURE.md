# 🗺️ Zone & Benutzer Synchronisations-Feature

## ✨ Übersicht

Das intelligente Zone- und Benutzer-Synchronisations-Feature verbindet deine Einkaufslisten mit den physischen Orten in Home Assistant. Die App erkennt automatisch, wo du dich befindest, und öffnet die relevante Einkaufsliste.

### Beispiel-Szenario:

```
Max ist unterwegs mit der App.

1. Max betritt den DM-Drogeriemarkt
   ↓
2. Home Assistant aktualisiert seine Location zu 'zone.dm_markt'
   ↓
3. Die Einkaufsliste-App erkennt: "Max ist bei DM"
   ↓
4. App öffnet automatisch die Liste "Drogerie" mit den DM-relevanten Produkten
   ↓
5. Max sieht eine Benachrichtigung: "📍 Drogerie ist in Ihrer Nähe"
   ↓
6. Einkaufen wird einfacher!

```

---

## 🗄️ Datenbankstruktur

### Erweiterte `users` Tabelle:
```sql
ALTER TABLE users ADD COLUMN ha_person_entity_id TEXT;
-- Speichert z.B. 'person.max' oder 'person.sabine'
```

### Neue `zone_mappings` Tabelle:
```sql
CREATE TABLE zone_mappings (
  id INTEGER PRIMARY KEY,
  list_id INTEGER,          -- Welche Liste
  zone_entity_id TEXT,      -- z.B. 'zone.dm_markt'
  zone_name TEXT,           -- Benutzerfreundlicher Name
  created_at DATETIME,
  FOREIGN KEY (list_id) REFERENCES lists(id)
);
```

### Indizes für Performance:
```sql
CREATE INDEX idx_zone_mappings_list_id ON zone_mappings(list_id);
CREATE INDEX idx_zone_mappings_zone_entity ON zone_mappings(zone_entity_id);
```

---

## 🔌 Backend API Endpunkte

### 1. Home Assistant Ressourcen Abrufen

#### GET `/api/setup/ha-persons`
Alle verfügbaren HA-Personen-Entitäten abrufen
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/setup/ha-persons

# Response:
[
  {
    "entity_id": "person.max",
    "friendly_name": "Max",
    "icon": "mdi:account",
    "state": "zone.home"
  },
  {
    "entity_id": "person.sabine",
    "friendly_name": "Sabine",
    "icon": "mdi:account",
    "state": "zone.dm_markt"
  }
]
```

#### GET `/api/setup/ha-zones`
Alle verfügbaren HA-Zonen abrufen
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/setup/ha-zones

# Response:
[
  {
    "entity_id": "zone.home",
    "friendly_name": "Zuhause",
    "icon": "mdi:home",
    "latitude": 51.5074,
    "longitude": -0.1278,
    "radius": 100
  },
  {
    "entity_id": "zone.dm_markt",
    "friendly_name": "DM Markt",
    "icon": "mdi:shopping",
    "latitude": 51.5200,
    "longitude": -0.1300,
    "radius": 50
  }
]
```

### 2. Benutzer-Person Zuordnung

#### PATCH `/api/users/:userId/ha-person`
Benutzer zu Home Assistant Person zuordnen
```bash
curl -X PATCH \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ha_person_entity_id": "person.max"}' \
  http://localhost:3000/api/users/1/ha-person

# Response:
{
  "id": 1,
  "username": "max",
  "is_admin": true,
  "ha_person_entity_id": "person.max",
  "created_at": "2026-09-18T10:00:00Z"
}
```

#### GET `/api/users/:userId`
Benutzer-Details mit HA-Person-Zuordnung
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/users/1

# Response:
{
  "id": 1,
  "username": "max",
  "is_admin": true,
  "ha_person_entity_id": "person.max",
  "created_at": "2026-09-18T10:00:00Z"
}
```

### 3. Listen-Zone Zuordnung

#### GET `/api/lists/:listId/zones`
Zonen für eine Liste abrufen
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/lists/5/zones

# Response:
[
  {
    "id": 1,
    "zone_entity_id": "zone.dm_markt",
    "zone_name": "DM Markt",
    "created_at": "2026-09-18T10:00:00Z"
  },
  {
    "id": 2,
    "zone_entity_id": "zone.rossmann",
    "zone_name": "Rossmann",
    "created_at": "2026-09-18T10:01:00Z"
  }
]
```

#### PATCH `/api/lists/:listId/zones`
Zonen für eine Liste setzen (Admin-only)
```bash
curl -X PATCH \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zones": [
      {"zone_entity_id": "zone.dm_markt", "zone_name": "DM Markt"},
      {"zone_entity_id": "zone.rossmann", "zone_name": "Rossmann"}
    ]
  }' \
  http://localhost:3000/api/lists/5/zones

# Response:
[
  {"id": 1, "zone_entity_id": "zone.dm_markt", "zone_name": "DM Markt", ...},
  {"id": 2, "zone_entity_id": "zone.rossmann", "zone_name": "Rossmann", ...}
]
```

### 4. Benutzer-Location Abrufen

#### GET `/api/user/current-zone`
Aktuelle Zone des eingeloggten Benutzers
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/user/current-zone

# Response:
{
  "person_entity_id": "person.max",
  "current_zone": "zone.dm_markt",
  "friendly_name": "Max",
  "last_updated": "2026-09-18T14:30:00Z"
}
```

#### GET `/api/user/recommended-list`
Empfohlene Liste basierend auf aktueller Zone
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/api/user/recommended-list

# Response bei Match:
{
  "recommendedList": {
    "id": 5,
    "name": "Drogerie",
    "description": "DM und Rossmann Einkäufe",
    "category": "drugstore",
    "icon": "💅",
    "color": "#ec4899"
  },
  "zone": "zone.dm_markt",
  "personLocation": "Max"
}

# Response bei kein Match:
{
  "recommendedList": null,
  "reason": "No list mapped for current zone",
  "zone": "zone.home"
}
```

---

## 📱 Frontend Funktionalität

### Auto-Selection beim App-Start
```javascript
// Beim Laden der Webapp wird autoSelectRecommendedList() aufgerufen:
async function autoSelectRecommendedList() {
  const result = await apiCall('GET', '/api/user/recommended-list');
  
  if (result.recommendedList) {
    // Automatisch die richtige Liste öffnen
    listSelector.value = result.recommendedList.id;
    listSelector.dispatchEvent(new Event('change'));
    
    // Zeige Benachrichtigung
    // "📍 Drogerie ist in Ihrer Nähe (zone.dm_markt)"
  }
}
```

### UI Notification
```
┌─────────────────────────────────┐
│ 📍 Drogerie ist in Ihrer Nähe   │
│ (zone.dm_markt)                 │
└─────────────────────────────────┘
(Verschwindet nach 5 Sekunden automatisch)
```

### Animation
- Gleitet von rechts ein (0.3s)
- Bleibt 5 Sekunden sichtbar
- Gleitet nach rechts aus (0.3s)

---

## ⚙️ Admin-Dashboard (Neues Tab: "🗺️ Zonen-Mapping")

### Benutzer zu Home Assistant Personen zuordnen

```
┌─────────────────────────────────────────┐
│ Benutzer zu Home Assistant             │
│ Personen zuordnen                       │
├─────────────────────────────────────────┤
│                                          │
│ Benutzer wählen:        [Dropdown ▼]   │
│ HA-Person wählen:       [Dropdown ▼]   │
│                                          │
│              [🔗 Zuordnen]              │
├─────────────────────────────────────────┤
│                                          │
│ Tabelle: Benutzer-Person-Zuordnung      │
│ ┌──────────┬────────────────┬─────────┐ │
│ │ Username │ HA-Person      │ Status  │ │
│ ├──────────┼────────────────┼─────────┤ │
│ │ max      │ person.max     │ ✅      │ │
│ │ sabine   │ Nicht zugeord. │ ❌      │ │
│ └──────────┴────────────────┴─────────┘ │
└─────────────────────────────────────────┘
```

### Listen mit Zonen verknüpfen

```
┌──────────────────────────────────────────┐
│ Listen mit Zonen verknüpfen              │
├──────────────────────────────────────────┤
│                                           │
│ Liste wählen:      [Dropdown ▼]         │
│ Zone wählen:       [Dropdown ▼] [➕]    │
├──────────────────────────────────────────┤
│                                           │
│ Zonenverbindungen für: Drogerie         │
│ ┌──────────────────────────────────────┐ │
│ │ DM Markt (zone.dm_markt)    [🗑️]    │ │
│ │ Rossmann (zone.rossmann)    [🗑️]    │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

---

## 🚀 Workflow: Kompletter Setup

### Step 1: Home Assistant Setup
```
In Home Assistant muss es geben:
- person.max (oder person.sabine, person.mueller, etc.)
- zone.home, zone.dm_markt, zone.rossmann, etc.
```

### Step 2: App-Admin konfiguriert Zuordnungen
```
1. Admin öffnet das App-Dashboard
2. Navigiert zu "🗺️ Zonen-Mapping" Tab
3. Ordnet Benutzer zu Personen zu:
   - Max → person.max
   - Sabine → person.sabine
4. Ordnet Listen zu Zonen zu:
   - "Drogerie" → zone.dm_markt, zone.rossmann
   - "Hardware" → zone.baumarkt
   - "Lebensmittel" → zone.rewe, zone.edeka
```

### Step 3: Benutzer nutzt die App
```
1. Max öffnet die App zuhause
   → Keine automatische Liste
   
2. Max geht zum DM-Markt
   → App erkennt: Max in zone.dm_markt
   → App öffnet automatisch: "Drogerie"
   → Notification: "📍 Drogerie ist in Ihrer Nähe"
   
3. Max geht zum Edeka
   → App erkennt: Max in zone.edeka
   → App öffnet automatisch: "Lebensmittel"
   → Notification: "📍 Lebensmittel ist in Ihrer Nähe"
   
4. Max geht nach Hause
   → App erkennt: Max in zone.home
   → Keine Liste zugeordnet → keine Aktion
```

---

## 🔐 Sicherheit & Permissions

✅ **User kann nur sehen:**
- Seine eigene HA-Person-Zuordnung (GET /api/users/:id)
- Empfohlene Listen basierend auf seiner Zone

✅ **Admin kann:**
- User-Person-Zuordnungen verwalten
- Listen-Zone-Zuordnungen verwalten
- Alle Ressourcen einsehen

✅ **Keine Risiken:**
- Personen-Daten bleiben in HA
- App fragt nur Status ab (read-only)
- Berechtigungen werden nicht umgangen

---

## 🧪 Test-Szenarios

### Scenario 1: Manuelle Zone-Zuordnung
```bash
# Als Admin: Liste mit Zone verknüpfen
curl -X PATCH \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{
    "zones": [
      {"zone_entity_id": "zone.dm_markt", "zone_name": "DM"}
    ]
  }' \
  http://localhost:3000/api/lists/5/zones

# Dann in der App Auto-Selection testen
```

### Scenario 2: Person versetzen
```bash
# In Home Assistant die Person versetzen
developer_call_service(
  domain="person",
  service="set_location",
  service_data={
    "entity_id": "person.max",
    "latitude": 51.5200,
    "longitude": -0.1300
  }
)

# App sofort neu laden
# Sollte neue empfohlene Liste zeigen
```

### Scenario 3: Offline Fallback
```bash
# HA ist offline/unreachbar
curl http://localhost:3000/api/user/recommended-list

# Response:
{
  "recommendedList": null,
  "reason": "HA unreachable",
  "error": "..."
}

# App zeigt nicht autom. Liste, aber funktioniert noch
# User kann manuell Liste wählen
```

---

## 📊 Daten-Flow Diagramm

```
┌──────────────────────┐
│   Browser/App        │
│  (Benutzer Max)      │
└──────┬───────────────┘
       │ GET /api/user/recommended-list
       ↓
┌──────────────────────┐
│   Backend Server     │
│   (Express)          │
└──────┬───────────────┘
       │ Query: Welche Person hat User Max?
       ↓
┌──────────────────────┐
│    SQLite DB         │
│  users table         │
│  ha_person_entity_id │
│  = person.max        │
└──────┬───────────────┘
       │ Personen-ID: person.max
       ↓
┌──────────────────────┐
│  Home Assistant      │
│  API                 │
│  GET /api/states/    │
│  person.max          │
│  state: zone.dm_...  │
└──────┬───────────────┘
       │ Aktuelle Zone: zone.dm_markt
       ↓
┌──────────────────────┐
│    Backend Server    │
│    SQLite DB         │
│  zone_mappings       │
│  Query: Welche Liste │
│  für zone.dm_markt?  │
└──────┬───────────────┘
       │ Liste #5: Drogerie
       ↓
┌──────────────────────┐
│   Browser/App        │
│  Auto-Open:          │
│  "Drogerie"          │
│  Notification 📍     │
└──────────────────────┘
```

---

## 🎯 Performance & Optimierungen

### Caching
- Zone-Mappings: Geladen einmal im Admin Dashboard
- Person-Status: Wird pro Request abgefragt (max. 100ms HA-Latenz)

### Indizes
```sql
-- Schnelle Zone-Lookups
CREATE INDEX idx_zone_mappings_zone_entity ON zone_mappings(zone_entity_id);

-- Schnelle User-Lookups
CREATE INDEX idx_users_ha_person ON users(ha_person_entity_id);
```

### Fehlerbehandlung
- HA ist offline? → API gibt "unreachable" zurück
- Person nicht zugeordnet? → API gibt "no mapping" zurück
- Keine Liste für Zone? → Kein Auto-Select, App funktioniert normal

---

## 🚀 Zukünftige Erweiterungen

- [ ] Mehrere Zonen pro Benutzer (z.B. bei Familien)
- [ ] Zone-basierte Benachrichtigungen ("Vergiss nicht: Milch!")
- [ ] Zeitbasierte Automatisierung ("Mo-Fr 8:00 = Büro-Liste")
- [ ] Statistiken ("Wie oft warst du bei DM?")
- [ ] QR-Code zum Schnell-Teilen von Zone-Mappings
- [ ] Mobile Push-Benachrichtigungen bei Zonen-Wechsel

---

## 📝 Zusammenfassung

| Komponente | Status | Beschreibung |
|-----------|--------|-------------|
| Database Schema | ✅ Complete | users.ha_person_entity_id + zone_mappings table |
| HA Integration | ✅ Complete | getHAPersons(), getHAZones(), getPersonLocation() |
| API Endpoints | ✅ Complete | 7 neue Routen implementiert |
| Admin UI | ✅ Complete | Neues Zonen-Mapping Tab |
| Frontend Auto-Select | ✅ Complete | autoSelectRecommendedList() mit Benachrichtigung |
| Error Handling | ✅ Complete | Graceful Fallback bei HA-Fehler |

**Ergebnis: Intelligente, Location-Aware Shopping List! 🎉**

---

## 📞 Fehlerbehandlung

### Häufige Fehler und Lösungen

**Fehler: "User has no HA person entity mapped"**
```
Lösung: Admin Dashboard → Zonen-Mapping → User zu Person zuordnen
```

**Fehler: "No list mapped for current zone"**
```
Lösung: Admin Dashboard → Listen-Zone verknüpfen
```

**Fehler: "HA unreachable"**
```
Lösung: Home Assistant Connection prüfen, App funktioniert noch normal
```

**Auto-Selection funktioniert nicht**
```
Checks:
1. Ist der User zu einer Person zugeordnet?
2. Ist die aktuelle Zone in Home Assistant richtig?
3. Ist die Liste mit der Zone verknüpft?
4. Hat der User Zugriff auf die Liste?
```

---

Viel Erfolg mit der intelligenten Zonen-basierten Einkaufsliste! 🗺️📍🛒
