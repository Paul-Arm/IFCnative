//! Low level ISO 10303-21 (STEP physical file) handling: record scanning,
//! value parsing/formatting and string encoding.

use memchr::{memchr, memchr2};
use std::fmt::Write as _;

/// A parsed STEP value.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// `$`
    Null,
    /// `*`
    Derived,
    Int(i64),
    Real(f64),
    /// Decoded string.
    Str(String),
    /// Enumeration literal without dots (`.T.` -> `T`).
    Enum(String),
    Ref(u32),
    List(Vec<Value>),
    /// Typed value such as `IFCLABEL('x')` (type name upper case).
    Typed(String, Box<Value>),
    /// Binary literal (hex digits including the leading count digit).
    Binary(String),
}

impl Value {
    pub fn as_ref_id(&self) -> Option<u32> {
        match self {
            Value::Ref(r) => Some(*r),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Real(f) => Some(*f),
            Value::Int(i) => Some(*i as f64),
            Value::Typed(_, v) => v.as_f64(),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            Value::Real(f) => Some(*f as i64),
            Value::Typed(_, v) => v.as_i64(),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Typed(_, v) => v.as_str(),
            _ => None,
        }
    }
    pub fn as_enum(&self) -> Option<&str> {
        match self {
            Value::Enum(s) => Some(s),
            Value::Typed(_, v) => v.as_enum(),
            _ => None,
        }
    }
    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(l) => Some(l),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
    pub fn refs(&self) -> Vec<u32> {
        let mut out = Vec::new();
        self.collect_refs(&mut out);
        out
    }
    pub fn collect_refs(&self, out: &mut Vec<u32>) {
        match self {
            Value::Ref(r) => out.push(*r),
            Value::List(l) => l.iter().for_each(|v| v.collect_refs(out)),
            Value::Typed(_, v) => v.collect_refs(out),
            _ => {}
        }
    }
    /// List of reference ids (non-refs skipped).
    pub fn ref_list(&self) -> Vec<u32> {
        match self {
            Value::List(l) => l.iter().filter_map(|v| v.as_ref_id()).collect(),
            Value::Ref(r) => vec![*r],
            _ => vec![],
        }
    }

    /// Human readable rendering (strings unquoted, typed values unwrapped).
    pub fn display(&self) -> String {
        match self {
            Value::Null => String::new(),
            Value::Derived => "*".into(),
            Value::Int(i) => i.to_string(),
            Value::Real(f) => fmt_real_display(*f),
            Value::Str(s) => s.clone(),
            Value::Enum(e) => match e.as_str() {
                "T" => "TRUE".into(),
                "F" => "FALSE".into(),
                "U" => "UNKNOWN".into(),
                _ => e.clone(),
            },
            Value::Ref(r) => format!("#{r}"),
            Value::List(l) => {
                let parts: Vec<String> = l.iter().map(|v| v.display()).collect();
                format!("({})", parts.join(", "))
            }
            Value::Typed(_, v) => v.display(),
            Value::Binary(b) => format!("\"{b}\""),
        }
    }

    /// Serialise to STEP text.
    pub fn to_step(&self) -> String {
        let mut s = String::new();
        self.write_step(&mut s);
        s
    }

    pub fn write_step(&self, out: &mut String) {
        match self {
            Value::Null => out.push('$'),
            Value::Derived => out.push('*'),
            Value::Int(i) => {
                let _ = write!(out, "{i}");
            }
            Value::Real(f) => out.push_str(&fmt_real(*f)),
            Value::Str(s) => {
                out.push('\'');
                out.push_str(&encode_string(s));
                out.push('\'');
            }
            Value::Enum(e) => {
                out.push('.');
                out.push_str(e);
                out.push('.');
            }
            Value::Ref(r) => {
                let _ = write!(out, "#{r}");
            }
            Value::List(l) => {
                out.push('(');
                for (i, v) in l.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write_step(out);
                }
                out.push(')');
            }
            Value::Typed(t, v) => {
                out.push_str(t);
                out.push('(');
                v.write_step(out);
                out.push(')');
            }
            Value::Binary(b) => {
                out.push('"');
                out.push_str(b);
                out.push('"');
            }
        }
    }
}

/// Write a list of argument values as the inside of `TYPE( ... )`.
pub fn args_to_step(args: &[Value]) -> String {
    let mut s = String::with_capacity(args.len() * 8);
    for (i, v) in args.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        v.write_step(&mut s);
    }
    s
}

/// STEP REAL formatting: always contains a decimal point, shortest round-trip.
pub fn fmt_real(f: f64) -> String {
    if !f.is_finite() {
        return "0.".into();
    }
    if f == 0.0 {
        return "0.".into();
    }
    let a = f.abs();
    if !(1e-6..1e15).contains(&a) {
        // exponent form: mantissa must contain '.'
        let s = format!("{f:E}");
        if let Some((m, e)) = s.split_once('E') {
            let m = if m.contains('.') { m.to_string() } else { format!("{m}.") };
            return format!("{m}E{e}");
        }
        return s;
    }
    let mut s = format!("{f}");
    if !s.contains('.') {
        s.push('.');
    }
    s
}

/// Rounded display for UI (avoids 0.30000000000000004).
pub fn fmt_real_display(f: f64) -> String {
    if f == f.trunc() && f.abs() < 1e15 {
        return format!("{}", f as i64);
    }
    let s = format!("{:.10}", f);
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    if s.is_empty() || s == "-" || s == "-0" {
        "0".into()
    } else {
        s
    }
}

/// Encode a unicode string into STEP string content (without quotes).
pub fn encode_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    let mut pending: Vec<u16> = Vec::new();
    let flush = |pending: &mut Vec<u16>, out: &mut String| {
        if !pending.is_empty() {
            out.push_str("\\X2\\");
            for u in pending.iter() {
                let _ = write!(out, "{u:04X}");
            }
            out.push_str("\\X0\\");
            pending.clear();
        }
    };
    for ch in s.chars() {
        if (' '..='~').contains(&ch) {
            flush(&mut pending, &mut out);
            match ch {
                '\'' => out.push_str("''"),
                '\\' => out.push_str("\\\\"),
                c => out.push(c),
            }
        } else {
            let mut buf = [0u16; 2];
            pending.extend_from_slice(ch.encode_utf16(&mut buf));
        }
    }
    flush(&mut pending, &mut out);
    out
}

fn hex_val(b: u8) -> Option<u32> {
    match b {
        b'0'..=b'9' => Some((b - b'0') as u32),
        b'A'..=b'F' => Some((b - b'A' + 10) as u32),
        b'a'..=b'f' => Some((b - b'a' + 10) as u32),
        _ => None,
    }
}

/// Decode STEP string content (between the quotes, `''` still escaped).
pub fn decode_string(raw: &[u8]) -> String {
    // fast path: plain ASCII without escapes
    if !raw.iter().any(|&b| b == b'\\' || b == b'\'' || b >= 0x80) {
        return unsafe { String::from_utf8_unchecked(raw.to_vec()) };
    }
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let n = raw.len();
    let mut utf8_run: Vec<u8> = Vec::new();
    let flush_utf8 = |run: &mut Vec<u8>, out: &mut String| {
        if !run.is_empty() {
            match std::str::from_utf8(run) {
                Ok(s) => out.push_str(s),
                Err(_) => run.iter().for_each(|&b| out.push(b as char)), // latin-1 fallback
            }
            run.clear();
        }
    };
    while i < n {
        let b = raw[i];
        if b == b'\'' {
            flush_utf8(&mut utf8_run, &mut out);
            out.push('\'');
            i += if i + 1 < n && raw[i + 1] == b'\'' { 2 } else { 1 };
        } else if b == b'\\' {
            flush_utf8(&mut utf8_run, &mut out);
            if i + 1 < n && raw[i + 1] == b'\\' {
                out.push('\\');
                i += 2;
            } else if raw[i..].starts_with(b"\\X2\\") {
                i += 4;
                let mut units: Vec<u16> = Vec::new();
                while i + 4 <= n && raw[i] != b'\\' {
                    let mut v = 0u32;
                    let mut ok = true;
                    for k in 0..4 {
                        match hex_val(raw[i + k]) {
                            Some(h) => v = v * 16 + h,
                            None => ok = false,
                        }
                    }
                    if !ok {
                        break;
                    }
                    units.push(v as u16);
                    i += 4;
                }
                out.push_str(&String::from_utf16_lossy(&units));
                if raw[i..].starts_with(b"\\X0\\") {
                    i += 4;
                }
            } else if raw[i..].starts_with(b"\\X4\\") {
                i += 4;
                while i + 8 <= n && raw[i] != b'\\' {
                    let mut v = 0u32;
                    for k in 0..8 {
                        v = v * 16 + hex_val(raw[i + k]).unwrap_or(0);
                    }
                    if let Some(c) = char::from_u32(v) {
                        out.push(c);
                    }
                    i += 8;
                }
                if raw[i..].starts_with(b"\\X0\\") {
                    i += 4;
                }
            } else if raw[i..].starts_with(b"\\X\\") && i + 5 <= n {
                let v = hex_val(raw[i + 3]).unwrap_or(0) * 16 + hex_val(raw[i + 4]).unwrap_or(0);
                out.push(char::from_u32(v).unwrap_or('?'));
                i += 5;
            } else if raw[i..].starts_with(b"\\S\\") && i + 4 <= n {
                out.push(char::from_u32(raw[i + 3] as u32 + 128).unwrap_or('?'));
                i += 4;
            } else if raw[i..].starts_with(b"\\P") && i + 4 <= n && raw[i + 3] == b'\\' {
                i += 4; // code page switch: ignored (ISO 8859-1 assumed)
            } else if raw[i..].starts_with(b"\\N\\") {
                out.push('\n');
                i += 3;
            } else if raw[i..].starts_with(b"\\T\\") {
                out.push('\t');
                i += 3;
            } else {
                out.push('\\');
                i += 1;
            }
        } else if b >= 0x80 {
            utf8_run.push(b);
            i += 1;
        } else {
            flush_utf8(&mut utf8_run, &mut out);
            out.push(b as char);
            i += 1;
        }
    }
    flush_utf8(&mut utf8_run, &mut out);
    out
}

#[derive(Debug, Clone)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ParseError {}

/// Parser for the argument list of a STEP record (the text inside the outer parens).
pub struct ArgParser<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> ArgParser<'a> {
    pub fn new(b: &'a [u8]) -> Self {
        ArgParser { b, pos: 0 }
    }

    #[inline]
    fn ws(&mut self) {
        while self.pos < self.b.len() {
            let c = self.b[self.pos];
            if c == b' ' || c == b'\n' || c == b'\r' || c == b'\t' {
                self.pos += 1;
            } else if c == b'/' && self.b.get(self.pos + 1) == Some(&b'*') {
                match memchr::memmem::find(&self.b[self.pos + 2..], b"*/") {
                    Some(e) => self.pos += e + 4,
                    None => self.pos = self.b.len(),
                }
            } else {
                break;
            }
        }
    }

    pub fn parse_all(mut self) -> Result<Vec<Value>, ParseError> {
        let mut out = Vec::with_capacity(8);
        self.ws();
        if self.pos >= self.b.len() {
            return Ok(out);
        }
        loop {
            out.push(self.value()?);
            self.ws();
            if self.pos >= self.b.len() {
                break;
            }
            match self.b[self.pos] {
                b',' => {
                    self.pos += 1;
                    self.ws();
                }
                c => return Err(ParseError(format!("unerwartetes Zeichen '{}' an Position {}", c as char, self.pos))),
            }
        }
        Ok(out)
    }

    fn value(&mut self) -> Result<Value, ParseError> {
        self.ws();
        let Some(&c) = self.b.get(self.pos) else {
            return Err(ParseError("unerwartetes Ende".into()));
        };
        match c {
            b'$' => {
                self.pos += 1;
                Ok(Value::Null)
            }
            b'*' => {
                self.pos += 1;
                Ok(Value::Derived)
            }
            b'#' => {
                self.pos += 1;
                let start = self.pos;
                while self.pos < self.b.len() && self.b[self.pos].is_ascii_digit() {
                    self.pos += 1;
                }
                let id = parse_u32(&self.b[start..self.pos]).ok_or_else(|| ParseError("ungültige Referenz".into()))?;
                Ok(Value::Ref(id))
            }
            b'\'' => {
                self.pos += 1;
                let start = self.pos;
                loop {
                    match memchr(b'\'', &self.b[self.pos..]) {
                        Some(off) => {
                            self.pos += off;
                            if self.b.get(self.pos + 1) == Some(&b'\'') {
                                self.pos += 2;
                            } else {
                                let s = decode_string(&self.b[start..self.pos]);
                                self.pos += 1;
                                return Ok(Value::Str(s));
                            }
                        }
                        None => return Err(ParseError("String nicht abgeschlossen".into())),
                    }
                }
            }
            b'"' => {
                self.pos += 1;
                let start = self.pos;
                match memchr(b'"', &self.b[self.pos..]) {
                    Some(off) => {
                        self.pos += off + 1;
                        Ok(Value::Binary(String::from_utf8_lossy(&self.b[start..start + off]).into_owned()))
                    }
                    None => Err(ParseError("Binärwert nicht abgeschlossen".into())),
                }
            }
            b'.' => {
                self.pos += 1;
                let start = self.pos;
                match memchr(b'.', &self.b[self.pos..]) {
                    Some(off) => {
                        self.pos += off + 1;
                        Ok(Value::Enum(String::from_utf8_lossy(&self.b[start..start + off]).trim().to_ascii_uppercase()))
                    }
                    None => Err(ParseError("Enum nicht abgeschlossen".into())),
                }
            }
            b'(' => {
                self.pos += 1;
                let mut items = Vec::new();
                self.ws();
                if self.b.get(self.pos) == Some(&b')') {
                    self.pos += 1;
                    return Ok(Value::List(items));
                }
                loop {
                    items.push(self.value()?);
                    self.ws();
                    match self.b.get(self.pos) {
                        Some(b',') => self.pos += 1,
                        Some(b')') => {
                            self.pos += 1;
                            return Ok(Value::List(items));
                        }
                        _ => return Err(ParseError("Liste nicht abgeschlossen".into())),
                    }
                }
            }
            b'-' | b'+' | b'0'..=b'9' => {
                let start = self.pos;
                self.pos += 1;
                let mut is_real = false;
                while self.pos < self.b.len() {
                    let d = self.b[self.pos];
                    if d.is_ascii_digit() {
                        self.pos += 1;
                    } else if d == b'.' || d == b'E' || d == b'e' {
                        is_real = true;
                        self.pos += 1;
                    } else if (d == b'-' || d == b'+') && matches!(self.b[self.pos - 1], b'E' | b'e') {
                        self.pos += 1;
                    } else {
                        break;
                    }
                }
                let txt = unsafe { std::str::from_utf8_unchecked(&self.b[start..self.pos]) };
                if is_real {
                    parse_real(txt).map(Value::Real).ok_or_else(|| ParseError(format!("ungültige Zahl '{txt}'")))
                } else {
                    match txt.parse::<i64>() {
                        Ok(i) => Ok(Value::Int(i)),
                        Err(_) => parse_real(txt).map(Value::Real).ok_or_else(|| ParseError(format!("ungültige Zahl '{txt}'"))),
                    }
                }
            }
            c if c.is_ascii_alphabetic() || c == b'_' => {
                let start = self.pos;
                while self.pos < self.b.len() && (self.b[self.pos].is_ascii_alphanumeric() || self.b[self.pos] == b'_') {
                    self.pos += 1;
                }
                let name = String::from_utf8_lossy(&self.b[start..self.pos]).to_ascii_uppercase();
                self.ws();
                if self.b.get(self.pos) != Some(&b'(') {
                    return Err(ParseError(format!("'(' nach {name} erwartet")));
                }
                self.pos += 1;
                self.ws();
                let inner = if self.b.get(self.pos) == Some(&b')') { Value::Null } else { self.value()? };
                self.ws();
                if self.b.get(self.pos) != Some(&b')') {
                    return Err(ParseError(format!("')' nach {name}(...) erwartet")));
                }
                self.pos += 1;
                Ok(Value::Typed(name, Box::new(inner)))
            }
            c => Err(ParseError(format!("unerwartetes Zeichen '{}'", c as char))),
        }
    }
}

pub fn parse_real(txt: &str) -> Option<f64> {
    if let Ok(v) = txt.parse::<f64>() {
        return Some(v);
    }
    // "1.E5" style is accepted by Rust, but be lenient with oddities like "1.E" or "-.5"
    let fixed = txt.replace(".E", ".0E").replace(".e", ".0e");
    fixed.parse::<f64>().ok().or_else(|| fixed.trim_end_matches(['E', 'e']).parse::<f64>().ok())
}

#[inline]
pub fn parse_u32(b: &[u8]) -> Option<u32> {
    if b.is_empty() || b.len() > 10 {
        return None;
    }
    let mut v: u64 = 0;
    for &c in b {
        if !c.is_ascii_digit() {
            return None;
        }
        v = v * 10 + (c - b'0') as u64;
    }
    if v > u32::MAX as u64 {
        None
    } else {
        Some(v as u32)
    }
}

pub fn parse_args(b: &[u8]) -> Result<Vec<Value>, ParseError> {
    ArgParser::new(b).parse_all()
}

/// Call `f` for every `#id` reference in raw argument text (skipping strings).
#[inline]
pub fn for_each_ref(b: &[u8], mut f: impl FnMut(u32)) {
    let mut pos = 0;
    let n = b.len();
    while pos < n {
        match memchr2(b'#', b'\'', &b[pos..]) {
            None => return,
            Some(off) => {
                pos += off;
                if b[pos] == b'#' {
                    pos += 1;
                    let start = pos;
                    let mut v: u64 = 0;
                    while pos < n && b[pos].is_ascii_digit() {
                        v = v * 10 + (b[pos] - b'0') as u64;
                        pos += 1;
                    }
                    if pos > start && v <= u32::MAX as u64 {
                        f(v as u32);
                    }
                } else {
                    // skip string
                    pos += 1;
                    loop {
                        match memchr(b'\'', &b[pos..]) {
                            None => return,
                            Some(o) => {
                                pos += o + 1;
                                if pos < n && b[pos] == b'\'' {
                                    pos += 1;
                                } else {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// One scanned record: `#id = TYPE ( args ) ;`
#[derive(Debug, Clone, Copy)]
pub struct RawRec {
    pub id: u32,
    pub ty_start: usize,
    pub ty_len: u16,
    pub args_start: usize,
    pub args_len: u32,
}

#[derive(Debug, Default)]
pub struct ChunkScan {
    pub recs: Vec<RawRec>,
    pub first_start: usize,
    pub next_start: usize,
    pub errors: Vec<(usize, String)>,
    pub hit_endsec: bool,
}

#[inline]
fn skip_ws_comments(b: &[u8], mut pos: usize) -> usize {
    let n = b.len();
    while pos < n {
        let c = b[pos];
        if c == b' ' || c == b'\n' || c == b'\r' || c == b'\t' {
            pos += 1;
        } else if c == b'/' && pos + 1 < n && b[pos + 1] == b'*' {
            match memchr::memmem::find(&b[pos + 2..], b"*/") {
                Some(e) => pos += e + 4,
                None => return n,
            }
        } else {
            break;
        }
    }
    pos
}

/// Find end (index of ';') of a record whose argument text starts at `pos`, skipping strings.
#[inline]
fn find_record_end(b: &[u8], mut pos: usize) -> Option<usize> {
    let n = b.len();
    loop {
        let off = memchr2(b'\'', b';', &b[pos..])?;
        pos += off;
        if b[pos] == b';' {
            return Some(pos);
        }
        // string
        pos += 1;
        loop {
            let o = memchr(b'\'', &b[pos..])?;
            pos += o + 1;
            if pos < n && b[pos] == b'\'' {
                pos += 1;
            } else {
                break;
            }
        }
    }
}

/// Scan records starting at `start`; stops at the first record starting at or after `end`.
pub fn scan_chunk(b: &[u8], start: usize, end: usize) -> ChunkScan {
    let mut out = ChunkScan { recs: Vec::with_capacity((end - start) / 60 + 16), ..Default::default() };
    let n = b.len();
    let mut pos = skip_ws_comments(b, start);
    out.first_start = pos;
    loop {
        pos = skip_ws_comments(b, pos);
        if pos >= n {
            out.next_start = n;
            break;
        }
        if pos >= end {
            out.next_start = pos;
            break;
        }
        if b[pos] != b'#' {
            if b[pos..].starts_with(b"ENDSEC") {
                out.hit_endsec = true;
                out.next_start = n;
                break;
            }
            // garbage: skip to next ';'
            let e = find_record_end(b, pos).unwrap_or(n);
            out.errors.push((pos, "Unerwarteter Inhalt außerhalb eines Datensatzes".into()));
            pos = e + 1;
            continue;
        }
        let rec_start = pos;
        pos += 1;
        let id_start = pos;
        while pos < n && b[pos].is_ascii_digit() {
            pos += 1;
        }
        let id = parse_u32(&b[id_start..pos]);
        pos = skip_ws_comments(b, pos);
        if pos >= n || b[pos] != b'=' || id.is_none() {
            let e = find_record_end(b, pos.min(n)).unwrap_or(n);
            out.errors.push((rec_start, "Ungültiger Datensatzkopf".into()));
            pos = e + 1;
            continue;
        }
        pos = skip_ws_comments(b, pos + 1);
        let ty_start = pos;
        while pos < n && (b[pos].is_ascii_alphanumeric() || b[pos] == b'_') {
            pos += 1;
        }
        let ty_len = pos - ty_start;
        pos = skip_ws_comments(b, pos);
        if pos >= n || b[pos] != b'(' {
            let e = find_record_end(b, pos.min(n)).unwrap_or(n);
            out.errors.push((rec_start, "'(' erwartet".into()));
            pos = e + 1;
            continue;
        }
        let open = pos;
        let Some(semi) = find_record_end(b, open + 1) else {
            out.errors.push((rec_start, "Datensatz nicht abgeschlossen".into()));
            out.next_start = n;
            break;
        };
        // closing paren: last ')' before ';'
        let mut close = semi;
        while close > open && b[close - 1] != b')' {
            close -= 1;
        }
        let args_start = open + 1;
        let args_end = if close > open { close - 1 } else { semi };
        let (args_start, args_len) = if ty_len == 0 {
            // complex instance: keep everything between '(' and ')'
            (args_start, (args_end.saturating_sub(args_start)) as u32)
        } else {
            (args_start, (args_end.saturating_sub(args_start)) as u32)
        };
        out.recs.push(RawRec { id: id.unwrap(), ty_start, ty_len: ty_len.min(u16::MAX as usize) as u16, args_start, args_len });
        pos = semi + 1;
    }
    out
}

/// Candidate record start at or after `from`: position of a '#' that follows a ';' + whitespace.
pub fn align_to_record(b: &[u8], from: usize, limit: usize) -> usize {
    let mut pos = from;
    while pos < limit {
        match memchr(b';', &b[pos..limit]) {
            None => return limit,
            Some(o) => {
                pos += o + 1;
                let p = skip_ws_comments(b, pos);
                if p < b.len() && b[p] == b'#' {
                    // require "#digits ="
                    let mut q = p + 1;
                    while q < b.len() && b[q].is_ascii_digit() {
                        q += 1;
                    }
                    while q < b.len() && (b[q] == b' ' || b[q] == b'\t') {
                        q += 1;
                    }
                    if q > p + 1 && q < b.len() && b[q] == b'=' {
                        return p;
                    }
                }
            }
        }
    }
    limit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_roundtrip() {
        let txt = b"'2O2Fr$t4X7Zf8NOew3FLOH',#2,'Wall ''A''',$,(#3,#4),.T.,IFCLABEL('x'),1.5E-3,-2.,7,*";
        let v = parse_args(txt).unwrap();
        assert_eq!(v.len(), 11);
        assert_eq!(v[2], Value::Str("Wall 'A'".into()));
        assert_eq!(v[5], Value::Enum("T".into()));
        assert_eq!(v[6], Value::Typed("IFCLABEL".into(), Box::new(Value::Str("x".into()))));
        assert_eq!(v[7], Value::Real(0.0015));
        assert_eq!(v[8], Value::Real(-2.0));
        assert_eq!(v[9], Value::Int(7));
        let back = args_to_step(&v);
        assert_eq!(parse_args(back.as_bytes()).unwrap(), v);
    }

    #[test]
    fn strings() {
        assert_eq!(decode_string(b"Gr\\X2\\00FC\\X0\\n"), "Grün");
        assert_eq!(decode_string(b"\\S\\|"), "ü");
        assert_eq!(decode_string(b"a\\X\\E4b"), "aäb");
        assert_eq!(encode_string("Grün 'x'"), "Gr\\X2\\00FC\\X0\\n ''x''");
        assert_eq!(decode_string("Größe".as_bytes()), "Größe");
    }

    #[test]
    fn reals() {
        assert_eq!(fmt_real(1.0), "1.");
        assert_eq!(fmt_real(0.25), "0.25");
        assert_eq!(fmt_real(-3.5), "-3.5");
        assert_eq!(fmt_real(1e-9), "1.E-9");
        assert_eq!(parse_real("1."), Some(1.0));
        assert_eq!(parse_real("1.E-5"), Some(1e-5));
    }

    #[test]
    fn scan() {
        let data = b"#1=IFCA('x;y',#2);\n#2 = IFCB ( (1.,2.) , 'it''s;' ) ;\n/* c */ #3=IFCC();\nENDSEC;";
        let s = scan_chunk(data, 0, data.len());
        assert_eq!(s.recs.len(), 3);
        assert_eq!(s.recs[1].id, 2);
        let a = &data[s.recs[1].args_start..s.recs[1].args_start + s.recs[1].args_len as usize];
        assert_eq!(std::str::from_utf8(a).unwrap().trim(), "(1.,2.) , 'it''s;'");
        let mut refs = vec![];
        for_each_ref(b"'#9',#2,(#3,#44)", |r| refs.push(r));
        assert_eq!(refs, vec![2, 3, 44]);
    }
}

/// Scan header records (`NAME(args);`) of the HEADER section.
pub fn scan_chunk_header(b: &[u8]) -> Vec<(String, &[u8])> {
    let mut out = Vec::new();
    let mut pos = match memchr::memmem::find(b, b"HEADER") {
        Some(p) => p + 6,
        None => return out,
    };
    let n = b.len();
    loop {
        pos = skip_ws_comments(b, pos);
        if pos >= n {
            break;
        }
        if b[pos] == b';' {
            pos += 1;
            continue;
        }
        let name_start = pos;
        while pos < n && (b[pos].is_ascii_alphanumeric() || b[pos] == b'_' || b[pos] == b'-') {
            pos += 1;
        }
        let name = String::from_utf8_lossy(&b[name_start..pos]).to_ascii_uppercase();
        if name == "ENDSEC" || name.is_empty() {
            break;
        }
        pos = skip_ws_comments(b, pos);
        if pos >= n || b[pos] != b'(' {
            break;
        }
        let open = pos;
        let Some(semi) = find_record_end(b, open + 1) else { break };
        let mut close = semi;
        while close > open && b[close - 1] != b')' {
            close -= 1;
        }
        let end = if close > open + 1 { close - 1 } else { open + 1 };
        out.push((name, &b[open + 1..end]));
        pos = semi + 1;
    }
    out
}
