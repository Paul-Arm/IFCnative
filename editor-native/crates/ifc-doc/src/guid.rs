//! IFC GlobalId handling (22 character base64 compression of a 128 bit UUID).

const CHARS: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/// Compress 16 bytes into the 22 character IFC GUID form.
pub fn compress(bytes: &[u8; 16]) -> String {
    let mut n: u128 = 0;
    for b in bytes {
        n = (n << 8) | *b as u128;
    }
    let mut out = [0u8; 22];
    // first char encodes the top 2 bits, the remaining 21 chars 6 bits each
    for i in (0..22).rev() {
        out[i] = CHARS[(n & 63) as usize];
        n >>= 6;
    }
    String::from_utf8(out.to_vec()).unwrap()
}

pub fn expand(guid: &str) -> Option<[u8; 16]> {
    if guid.len() != 22 {
        return None;
    }
    let mut n: u128 = 0;
    for c in guid.bytes() {
        let v = CHARS.iter().position(|&x| x == c)? as u128;
        n = (n << 6) | v;
    }
    let mut out = [0u8; 16];
    for i in (0..16).rev() {
        out[i] = (n & 0xff) as u8;
        n >>= 8;
    }
    Some(out)
}

pub fn is_valid(guid: &str) -> bool {
    guid.len() == 22 && guid.as_bytes()[0] <= b'3' && guid.bytes().all(|c| CHARS.contains(&c))
}

/// New random (v4) IFC GUID.
pub fn new_guid() -> String {
    let mut b = random_bytes();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    compress(&b)
}

fn random_bytes() -> [u8; 16] {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0x9E3779B97F4A7C15);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) as u64;
    let c = COUNTER.fetch_add(0x9E3779B97F4A7C15, Ordering::Relaxed);
    let mut x = t ^ c.rotate_left(17) ^ (std::process::id() as u64).wrapping_mul(0xA24BAED4963EE407);
    let mut out = [0u8; 16];
    for chunk in out.chunks_mut(8) {
        // splitmix64
        x = x.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = x;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^= z >> 31;
        chunk.copy_from_slice(&z.to_le_bytes());
    }
    out
}

pub fn to_uuid_string(guid: &str) -> Option<String> {
    let b = expand(guid)?;
    Some(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        for _ in 0..100 {
            let g = new_guid();
            assert!(is_valid(&g), "{g}");
            assert_eq!(compress(&expand(&g).unwrap()), g);
        }
        // known value: all zero
        assert_eq!(compress(&[0; 16]), "0000000000000000000000");
    }
}
