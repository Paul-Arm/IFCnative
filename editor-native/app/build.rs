fn main() {
    // Embed the application icon and version info into the Windows executable.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "IFCnative");
        res.set("FileDescription", "IFCnative – nativer IFC-Editor");
        res.set("CompanyName", "IFCnative");
        if let Err(e) = res.compile() {
            println!("cargo:warning=Windows-Ressourcen konnten nicht eingebettet werden: {e}");
        }
    }
    println!("cargo:rerun-if-changed=assets/icon.ico");
}
