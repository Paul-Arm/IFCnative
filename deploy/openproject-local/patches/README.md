# Patch-Serie für OpenProject

`openproject-<Version>/` enthält unsere Änderungen an OpenProject als Patch-Serie, eine Datei je Commit (`git format-patch`). Sie liegt auf dem offiziellen Tag `v<Version>` von [opf/openproject](https://github.com/opf/openproject) und fügt die Erweiterungspunkte hinzu, die das Plugin nutzt. Im Plugin selbst gibt es dafür keine Laufzeit-Patches mehr.

Statt eines eigenen Forks liegt die Serie hier im privaten Repo. Ein GitHub-Fork von OpenProject wäre zwangsläufig öffentlich. Einen Fork braucht man nur, um die Änderungen OpenProject als Pull Request anzubieten.

| Patch | Erweiterungspunkt | genutzt im Plugin |
| --- | --- | --- |
| 0001 Allow further storage providers to resolve folder locations | `<provider>.queries.folder_location` im Adapter-Register | `ifc_hub_registry.rb` („Neuer Ordner“) |
| 0002 Let storage admin forms work for further providers | Parametername aus den Speichertypen, Formular aus dem Register | Admin-Formular „IFC Hub“ |
| 0003 Let plugins register storage upload strategies | `registerStorageUploadStrategy()` | `frontend/module/main.ts` (Upload mit Commit-Nachricht) |
| 0004 Let plugins extend the storage location picker | `registerLocationPickerExtension()` | `frontend/module/main.ts` (Datei als Ziel einer neuen Version) |

Das Dockerfile (`../Dockerfile`, Stufe `plugin`) wendet die Serie der Reihe nach auf die Quellen des offiziellen Images an. Passt ein Patch nicht, bricht der Build ab.

## Arbeitskopie

Arbeitskopie zum Ändern: ein flacher Klon des Tags mit eingespielter Serie, z. B. `C:\Users\paul.armerling\vscode\openproject-ifc-hub`.

```bash
git clone --depth 1 --branch v17.7.2 https://github.com/opf/openproject.git openproject-ifc-hub
cd openproject-ifc-hub && git checkout -b ifc-hub/v17.7.2
git am <IFCnative>/deploy/openproject-local/patches/openproject-17.7.2/*.patch
```

Nach Änderungen (neue oder geänderte Commits) die Serie neu ausgeben:

```bash
git format-patch --no-signature --zero-commit -o <IFCnative>/deploy/openproject-local/patches/openproject-17.7.2 v17.7.2..HEAD
```

Vorher die alten Dateien im Ordner löschen, damit keine veralteten Patches liegen bleiben.

## OpenProject-Update (vALT → vNEU)

1. Neuen Tag flach klonen und die alte Serie einspielen:
   ```bash
   git clone --depth 1 --branch vNEU https://github.com/opf/openproject.git op-neu
   cd op-neu && git checkout -b ifc-hub/vNEU
   git am -3 <IFCnative>/deploy/openproject-local/patches/openproject-ALT/*.patch
   ```
   Hält `git am` an, hat OpenProject genau diese Stelle geändert. Dann den Konflikt lösen und mit `git am --continue` weitermachen.
2. Serie für vNEU ausgeben (siehe oben, Ordner `openproject-NEU`).
3. Bauen: `build-image.ps1 -OpenProjectVersion NEU`, dann den Rauchtest laufen lassen. Er prüft unter anderem, dass die Erweiterungspunkte im Image angekommen sind.
