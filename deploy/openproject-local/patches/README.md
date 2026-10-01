# OpenProject-Fork als Patch

`openproject-<Version>.patch` ist der Diff des Fork-Branches `ifc-hub/v<Version>` gegenüber dem offiziellen Tag `v<Version>` von [opf/openproject](https://github.com/opf/openproject). Er fügt die Erweiterungspunkte hinzu, die das Plugin nutzt. Im Plugin selbst gibt es dafür keine Laufzeit-Patches mehr.

| Fork-Commit | Erweiterungspunkt | genutzt im Plugin |
| --- | --- | --- |
| Allow further storage providers to resolve folder locations | `<provider>.queries.folder_location` im Adapter-Register | `ifc_hub_registry.rb` („Neuer Ordner“) |
| Let storage admin forms work for further providers | Parametername aus den Speichertypen, Formular aus dem Register | Admin-Formular „IFC Hub“ |
| Let plugins register storage upload strategies | `registerStorageUploadStrategy()` | `frontend/module/main.ts` (Upload mit Commit-Nachricht) |
| Let plugins extend the storage location picker | `registerLocationPickerExtension()` | `frontend/module/main.ts` (Datei als Ziel einer neuen Version) |

Das Dockerfile (`../Dockerfile`, Stufe `plugin`) wendet den Patch auf die Quellen des offiziellen Images an. Passt er nicht, bricht der Build ab.

## Neuen Patch erzeugen

```bash
git -C <fork> diff v<Version> ifc-hub/v<Version> > deploy/openproject-local/patches/openproject-<Version>.patch
```

Oben in der Datei stehen als `#`-Kommentar Herkunft und Commit-Liste (`git log --format='#   %h %s' v<Version>..ifc-hub/v<Version>`); `git apply` überspringt diese Zeilen.

## OpenProject-Update

1. Im Fork den Tag holen und den Branch umsetzen:
   ```bash
   git fetch origin tag vNEU --depth 1
   git checkout -b ifc-hub/vNEU ifc-hub/vALT
   git rebase --onto vNEU vALT
   ```
   Konflikte zeigen genau die Stellen, an denen OpenProject unsere Erweiterungspunkte geändert hat.
2. Patch für `vNEU` erzeugen (siehe oben) und `OPENPROJECT_VERSION` im Build angeben: `build-image.ps1 -OpenProjectVersion NEU`.
3. Rauchtest laufen lassen. Er prüft unter anderem, dass die Erweiterungspunkte im Image angekommen sind.

Lokaler Klon des Forks: `C:\Users\paul.armerling\vscode\openproject-ifc-hub`. Er ist flach geklont, nur mit dem Stand von v17.7.2. Bis der Fork auf GitHub angelegt ist (`MarxKrontalPartner/openproject`), gibt es ihn nur dort.
