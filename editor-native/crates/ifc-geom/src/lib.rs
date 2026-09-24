//! IFCnative geometry kernel.
//!
//! Converts IFC products into triangle meshes: placements, units, profiles,
//! curves, extrusions, revolutions, sweeps, faceted/advanced B-reps,
//! tessellated face sets, mapped items, CSG primitives, boolean results and
//! opening voids (BSP based CSG), plus presentation colors.

pub mod clash;
pub mod csg;
pub mod engine;
pub mod mesh;
pub mod profile;
pub mod style;

pub use engine::{Cache, Color, Engine, GeomOptions, Part, ProductGeom};
