//! IFCnative document core: STEP parsing, schema, editable document model,
//! model queries and editing operations.

pub mod document;
pub mod model;
pub mod guid;
pub mod io;
pub mod schema;
pub mod step;

pub use document::{tflags, Diagnostic, Document, Header, Severity, Transaction, TypeInfo};
pub use schema::{Schema, SchemaId};
pub use step::Value;
