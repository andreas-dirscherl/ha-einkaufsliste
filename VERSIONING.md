# 📦 Versioning Guide

## Versioning Schema

Das Projekt nutzt ein **YYYY.MM.PATCH** Versionsschema:

```
2026.9.0
│    │  └─ Patch (laufende Nummer)
│    └───── Monat (09 = September)
└────────── Jahr (2026)
```

### Beispiele
- `2026.9.0` - September 2026, Patch 0
- `2026.9.1` - September 2026, Patch 1 (Bug Fix)
- `2026.10.0` - Oktober 2026, Patch 0 (neuer Monat)

---

## 🚀 Version verwenden

### Aktuelle Version prüfen
```bash
npm run version:check
```

Ausgabe:
```
📦 Current version: 2026.9.0 ✅ Current
📅 Today: 2026.9
```

### Patch-Version bumpen (z.B. Bug Fix)
```bash
npm run version:bump patch
# 2026.9.0 → 2026.9.1
```

Auto-Reset wenn der Monat sich geändert hat:
```bash
npm run version:bump patch
# 2026.9.1 → 2026.10.0 (Oktober)
```

### Minor-Version bumpen (neuer Monat/Feature)
```bash
npm run version:bump minor
# 2026.9.5 → 2026.10.0
```

---

## 🐳 Docker Image Tags

Automatische Tag-Generierung via GitHub Actions:

| Tag | Bedeutung |
|-----|-----------|
| `ghcr.io/andreas-dirscherl/ha-einkaufsliste:2026.9.0` | Spezifische Version |
| `ghcr.io/andreas-dirscherl/ha-einkaufsliste:latest` | Neuste Version (main branch) |
| `ghcr.io/andreas-dirscherl/ha-einkaufsliste:main` | Main branch |
| `ghcr.io/andreas-dirscherl/ha-einkaufsliste:sha-abc123` | Commit SHA |

### Beispiel Verwendung
```bash
# Spezifische Version (pinnen)
docker run ghcr.io/andreas-dirscherl/ha-einkaufsliste:2026.9.0

# Neueste Version
docker run ghcr.io/andreas-dirscherl/ha-einkaufsliste:latest

# Main branch
docker run ghcr.io/andreas-dirscherl/ha-einkaufsliste:main
```

---

## 📋 Workflow

### Bei jedem Push zu main/master:
1. ✅ Version aus `package.json` wird gelesen
2. ✅ Docker Image wird gebaut
3. ✅ Image wird als Tag zur Registry gepusht
4. ✅ `latest` Tag wird aktualisiert

### Beispiel Workflow
```
git commit -m "Fix: update zone mapping"
   ↓
npm run version:bump patch
   → Version: 2026.9.0 → 2026.9.1
   ↓
git add package.json
git commit -m "Bump version to 2026.9.1"
git push
   ↓
GitHub Actions läuft:
   • Baut Docker Image
   • Tag: ghcr.io/.../ha-einkaufsliste:2026.9.1
   • Tag: ghcr.io/.../ha-einkaufsliste:latest
```

---

## 🎯 Best Practices

### ✅ TU
- **Patch bumpen** für Bug Fixes: `npm run version:bump patch`
- **Minor bumpen** beim Release oder Feature Sprint: `npm run version:bump minor`
- **Version vor Push updaten**: `git push` geht nach dem Version-Bump
- **Version in commit message erwähnen**: "Bump version to 2026.9.1"

### ❌ NICHT
- ❌ Version manuell in package.json editieren
- ❌ Version vergessen vor commit
- ❌ Mehrere Versionierung pro Monat (einfach patch bumpen)

---

## 🔍 Automatische Version im Code

Die `package.json` Version wird automatisch vom Docker Image genutzt.
Falls du die Version im Code brauchst:

```javascript
import pkg from './package.json' assert { type: 'json' };
console.log(`App Version: ${pkg.version}`);
```

---

## 📅 Jahreswechsel

Beim Jahreswechsel automatisch korrekt:
```bash
npm run version:bump patch
# Dezember 2026: 2026.12.5 → 2026.12.6
# Januar 2027:   2026.12.6 → 2027.1.0
```

---

## 🚨 Troubleshooting

| Problem | Lösung |
|---------|--------|
| Version wird nicht aktualisiert | `npm run version:check` prüfen, ggf. `npm run version:bump patch` |
| Docker Tag stimmt nicht | GitHub Actions Logs prüfen → `Extract version from package.json` |
| Alte Version im Container | `docker pull` erzwingen: `docker run --pull=always ...` |
