//! File helpers: ifcZIP packing/unpacking.

use std::io::{Read, Write};

pub fn unzip_ifc(bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        let name = f.name().to_ascii_lowercase();
        if name.ends_with(".ifc") {
            let mut out = Vec::with_capacity(f.size() as usize);
            f.read_to_end(&mut out)?;
            return Ok(out);
        }
    }
    anyhow::bail!("Das ZIP-Archiv enthält keine .ifc-Datei")
}

pub fn zip_ifc(inner_name: &str, bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file(inner_name, opts)?;
        w.write_all(bytes)?;
        w.finish()?;
    }
    Ok(buf.into_inner())
}
