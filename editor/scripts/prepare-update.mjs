import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export function releaseManifest({ version, notes, baseUrl, signature }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Ungültige Version.");
  if (notes.version !== version || typeof notes.title !== "string" || !Array.isArray(notes.changes)
    || !notes.changes.every((item) => typeof item === "string") || !Number.isFinite(Date.parse(notes.publishedAt))) {
    throw new Error("Patchnotes müssen zur Installer-Version passen.");
  }
  const base = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
  if (base.protocol !== "https:" || base.hostname !== "stifctool.blob.core.windows.net"
    || base.pathname === "/" || base.search || base.hash || base.username || base.password) throw new Error("Ungültige Update-Basis-URL.");
  return {
    version, notes: `${notes.title}\n\n${notes.changes.map((line) => `• ${line}`).join("\n")}`,
    pub_date: new Date(notes.publishedAt).toISOString(),
    platforms: { "windows-x86_64": {
      url: new URL(`releases/${version}/IFCnative_${version}_x64-setup.exe`, base).href,
      signature: signature.trim(),
    } },
  };
}

function keyId(encoded) {
  const line = Buffer.from(encoded.trim(), "base64").toString("utf8").split(/\r?\n/)[1];
  const data = Buffer.from(line ?? "", "base64");
  if (data.length < 10) throw new Error("Ungültiger Updater-Schlüssel oder Signatur.");
  return data.subarray(2, 10).toString("hex");
}

async function main() {
  const pkg = await readJson(path.join(root, "package.json"));
  const channel = await readJson(path.join(root, "update-channel.json"));
  const version = pkg.version;
  const installer = path.resolve(root, process.argv[2] ?? `src-tauri/target/release/bundle/nsis/IFCnative_${version}_x64-setup.exe`);
  const notesPath = path.resolve(root, process.argv[3] ?? `patchnotes/${version}.json`);
  const notes = await readJson(notesPath);
  // Validate inputs before signing or copying anything. No upload is performed.
  releaseManifest({ version, notes, baseUrl: channel.baseUrl, signature: "pending" });
  if (!channel.publicKey) throw new Error("Öffentlicher Updater-Schlüssel fehlt.");
  const signatureCheck = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    // PowerShell 7 can pass its module paths to Windows PowerShell 5.1.
    // Import the security module belonging to the actual child interpreter.
    "try { $ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'); $s = Get-AuthenticodeSignature -LiteralPath $env:IFCNATIVE_RELEASE_INSTALLER; if ($s.Status -ne 'Valid') { exit 10 }; $v = (Get-Item -LiteralPath $env:IFCNATIVE_RELEASE_INSTALLER).VersionInfo.ProductVersion; if ($v -ne $env:IFCNATIVE_RELEASE_VERSION) { exit 11 } } catch { exit 12 }"],
  { env: { ...process.env, IFCNATIVE_RELEASE_INSTALLER: installer, IFCNATIVE_RELEASE_VERSION: version }, encoding: "utf8", windowsHide: true });
  if (signatureCheck.status === 10) throw new Error("Zuerst den Installer mit gültigem Windows-Zertifikat signieren.");
  if (signatureCheck.status === 11) throw new Error("Die Produktversion des Installers muss zur package.json passen.");
  if (signatureCheck.status !== 0) throw new Error("Die Windows-Signaturprüfung konnte nicht ausgeführt werden. PowerShell und das Modul Microsoft.PowerShell.Security prüfen.");
  const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
  const sign = spawnSync(process.execPath, [cli, "signer", "sign", installer], {
    cwd: root, windowsHide: true, encoding: "utf8",
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? path.join(root, ".release-keys/updater.key"),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" },
  });
  if (sign.status !== 0) throw new Error("Updater-Signatur fehlgeschlagen. Privaten Schlüssel und Passwort prüfen.");
  const signature = await readFile(`${installer}.sig`, "utf8");
  if (keyId(signature) !== keyId(channel.publicKey)) throw new Error("Die Signatur gehört nicht zum in der App hinterlegten öffentlichen Schlüssel.");
  const manifest = releaseManifest({ version, notes, baseUrl: channel.baseUrl, signature });
  const out = path.join(root, "release", `azure-${version}`);
  const binaryDir = path.join(out, "releases", version);
  await mkdir(binaryDir, { recursive: true });
  await mkdir(path.join(out, "patchnotes"), { recursive: true });
  const fileName = `IFCnative_${version}_x64-setup.exe`;
  await copyFile(installer, path.join(binaryDir, fileName));
  await copyFile(`${installer}.sig`, path.join(binaryDir, `${fileName}.sig`));
  await writeFile(path.join(out, "patchnotes", `${version}.json`), JSON.stringify(notes, null, 2) + "\n");
  await writeFile(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const hash = createHash("sha256").update(await readFile(installer)).digest("hex");
  console.log(`Manueller Upload vorbereitet: ${out}\nSHA256: ${hash}\nInstaller, .sig und Patchnotes zuerst hochladen; latest.json zuletzt ersetzen.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
