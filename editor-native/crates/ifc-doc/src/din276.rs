//! DIN 276 cost groups (Kostengruppen) as IFC classification: catalogue,
//! rule based suggestion per element, bulk assignment.

use crate::document::{tflags, Document};
use crate::{model, ops, Value};
use rustc_hash::FxHashMap;

pub const SYSTEM: &str = "DIN 276";

pub const CODES: &[(&str, &str)] = &[
    ("300", "Bauwerk – Baukonstruktionen"),
    ("310", "Baugrube/Erdbau"),
    ("311", "Herstellung"),
    ("312", "Umschließung"),
    ("313", "Wasserhaltung"),
    ("319", "Sonstiges zur KG 310"),
    ("320", "Gründung, Unterbau"),
    ("321", "Baugrundverbesserung"),
    ("322", "Flachgründungen und Bodenplatten"),
    ("323", "Tiefgründungen"),
    ("324", "Gründungsbeläge"),
    ("325", "Abdichtungen und Bekleidungen"),
    ("326", "Dränagen"),
    ("329", "Sonstiges zur KG 320"),
    ("330", "Außenwände/Vertikale Baukonstruktionen, außen"),
    ("331", "Tragende Außenwände"),
    ("332", "Nichttragende Außenwände"),
    ("333", "Außenstützen"),
    ("334", "Außenwandöffnungen"),
    ("335", "Außenwandbekleidungen, außen"),
    ("336", "Außenwandbekleidungen, innen"),
    ("337", "Elementierte Außenwandkonstruktionen"),
    ("338", "Lichtschutz zur KG 330"),
    ("339", "Sonstiges zur KG 330"),
    ("340", "Innenwände/Vertikale Baukonstruktionen, innen"),
    ("341", "Tragende Innenwände"),
    ("342", "Nichttragende Innenwände"),
    ("343", "Innenstützen"),
    ("344", "Innenwandöffnungen"),
    ("345", "Innenwandbekleidungen"),
    ("346", "Elementierte Innenwandkonstruktionen"),
    ("347", "Lichtschutz zur KG 340"),
    ("349", "Sonstiges zur KG 340"),
    ("350", "Decken/Horizontale Baukonstruktionen"),
    ("351", "Deckenkonstruktionen"),
    ("352", "Deckenöffnungen"),
    ("353", "Deckenbeläge"),
    ("354", "Deckenbekleidungen"),
    ("355", "Elementierte Deckenkonstruktionen"),
    ("359", "Sonstiges zur KG 350"),
    ("360", "Dächer"),
    ("361", "Dachkonstruktionen"),
    ("362", "Dachöffnungen"),
    ("363", "Dachbeläge"),
    ("364", "Dachbekleidungen"),
    ("365", "Elementierte Dachkonstruktionen"),
    ("366", "Lichtschutz zur KG 360"),
    ("369", "Sonstiges zur KG 360"),
    ("370", "Infrastrukturanlagen"),
    ("380", "Baukonstruktive Einbauten"),
    ("381", "Allgemeine Einbauten"),
    ("382", "Besondere Einbauten"),
    ("389", "Sonstiges zur KG 380"),
    ("390", "Sonstige Maßnahmen für Baukonstruktionen"),
    ("400", "Bauwerk – Technische Anlagen"),
    ("410", "Abwasser-, Wasser-, Gasanlagen"),
    ("411", "Abwasseranlagen"),
    ("412", "Wasseranlagen"),
    ("413", "Gasanlagen"),
    ("419", "Sonstiges zur KG 410"),
    ("420", "Wärmeversorgungsanlagen"),
    ("421", "Wärmeerzeugungsanlagen"),
    ("422", "Wärmeverteilnetze"),
    ("423", "Raumheizflächen"),
    ("424", "Verkehrsheizflächen"),
    ("429", "Sonstiges zur KG 420"),
    ("430", "Raumlufttechnische Anlagen"),
    ("431", "Lüftungsanlagen"),
    ("432", "Teilklimaanlagen"),
    ("433", "Klimaanlagen"),
    ("434", "Kälteanlagen"),
    ("439", "Sonstiges zur KG 430"),
    ("440", "Elektrische Anlagen"),
    ("441", "Hoch- und Mittelspannungsanlagen"),
    ("442", "Eigenstromversorgungsanlagen"),
    ("443", "Niederspannungsschaltanlagen"),
    ("444", "Niederspannungsinstallationsanlagen"),
    ("445", "Beleuchtungsanlagen"),
    ("446", "Blitzschutz- und Erdungsanlagen"),
    ("449", "Sonstiges zur KG 440"),
    ("450", "Kommunikations-, sicherheits- und informationstechnische Anlagen"),
    ("451", "Telekommunikationsanlagen"),
    ("456", "Gefahrenmelde- und Alarmanlagen"),
    ("457", "Datenübertragungsnetze"),
    ("459", "Sonstiges zur KG 450"),
    ("460", "Förderanlagen"),
    ("461", "Aufzugsanlagen"),
    ("462", "Fahrtreppen, Fahrsteige"),
    ("469", "Sonstiges zur KG 460"),
    ("470", "Nutzungsspezifische und verfahrenstechnische Anlagen"),
    ("471", "Küchentechnische Anlagen"),
    ("474", "Feuerlöschanlagen"),
    ("479", "Sonstiges zur KG 470"),
    ("480", "Gebäude- und Anlagenautomation"),
    ("490", "Sonstige Maßnahmen für technische Anlagen"),
    ("600", "Ausstattung und Kunstwerke"),
    ("610", "Allgemeine Ausstattung"),
    ("620", "Besondere Ausstattung"),
    ("690", "Sonstige Ausstattung"),
];

pub fn name_of(code: &str) -> Option<&'static str> {
    CODES.iter().find(|c| c.0 == code).map(|c| c.1)
}

fn prop_bool(doc: &Document, id: u32, prop: &str) -> Option<bool> {
    model::psets_of(doc, id).into_iter().flat_map(|p| p.props).find(|p| p.name == prop).and_then(|p| match p.value.display().to_ascii_uppercase().as_str() {
        "TRUE" | "T" => Some(true),
        "FALSE" | "F" => Some(false),
        _ => None,
    })
}

fn predefined(doc: &Document, id: u32) -> String {
    let own = doc.attr(id, "PredefinedType").map(|v| v.display()).unwrap_or_default();
    if !own.is_empty() && own != "NOTDEFINED" && own != "USERDEFINED" {
        return own;
    }
    model::type_of(doc, id).and_then(|t| doc.attr(t, "PredefinedType").map(|v| v.display())).unwrap_or(own)
}

/// Rule based cost group for an element (None = no rule applies).
pub fn suggest(doc: &Document, id: u32) -> Option<&'static str> {
    let ty = doc.type_name(id)?.trim_start_matches("IFC");
    let ext = prop_bool(doc, id, "IsExternal");
    let lb = prop_bool(doc, id, "LoadBearing");
    let pt = predefined(doc, id);
    Some(match ty {
        "WALL" | "WALLSTANDARDCASE" | "WALLELEMENTEDCASE" => match (ext, lb) {
            (Some(true), Some(false)) => "332",
            (Some(true), _) => "331",
            (Some(false), Some(true)) => "341",
            (Some(false), _) => "342",
            (None, Some(true)) => "341",
            (None, _) => "340",
        },
        "CURTAINWALL" => "337",
        "COLUMN" | "COLUMNSTANDARDCASE" => {
            if ext == Some(true) {
                "333"
            } else {
                "343"
            }
        }
        "WINDOW" | "WINDOWSTANDARDCASE" => {
            if ext == Some(false) {
                "344"
            } else if pt == "SKYLIGHT" || pt == "LIGHTDOME" {
                "362"
            } else {
                "334"
            }
        }
        "DOOR" | "DOORSTANDARDCASE" => {
            if ext == Some(true) {
                "334"
            } else if pt == "TRAPDOOR" {
                "352"
            } else {
                "344"
            }
        }
        "SLAB" | "SLABSTANDARDCASE" | "SLABELEMENTEDCASE" => match pt.as_str() {
            "ROOF" => "361",
            "BASESLAB" => "322",
            _ => "351",
        },
        "ROOF" => "361",
        "BEAM" | "BEAMSTANDARDCASE" => "351",
        "STAIR" | "STAIRFLIGHT" | "RAMP" | "RAMPFLIGHT" => "351",
        "RAILING" => "359",
        "FOOTING" => "322",
        "PILE" => "323",
        "COVERING" => match pt.as_str() {
            "CEILING" => "354",
            "FLOORING" => "353",
            "ROOFING" => "363",
            "CLADDING" => {
                if ext == Some(false) {
                    "345"
                } else {
                    "335"
                }
            }
            "INSULATION" | "MEMBRANE" => "325",
            _ => "345",
        },
        "SHADINGDEVICE" => "338",
        "FURNISHINGELEMENT" | "FURNITURE" | "SYSTEMFURNITUREELEMENT" => "610",
        "PIPESEGMENT" | "PIPEFITTING" | "VALVE" | "PUMP" | "TANK" => "410",
        "SANITARYTERMINAL" => "412",
        "WASTETERMINAL" | "INTERCEPTOR" => "411",
        "BOILER" | "BURNER" | "HEATEXCHANGER" => "421",
        "SPACEHEATER" => "423",
        "CHIMNEY" => "429",
        "DUCTSEGMENT" | "DUCTFITTING" | "DUCTSILENCER" | "AIRTERMINAL" | "AIRTERMINALBOX" | "FAN" | "DAMPER" | "AIRTOAIRHEATRECOVERY" | "FILTER" => "431",
        "UNITARYEQUIPMENT" | "AIRHANDLINGUNIT" => "433",
        "CHILLER" | "COOLINGTOWER" | "CONDENSER" | "EVAPORATOR" | "COMPRESSOR" => "434",
        "CABLESEGMENT" | "CABLEFITTING" | "CABLECARRIERSEGMENT" | "CABLECARRIERFITTING" | "OUTLET" | "SWITCHINGDEVICE" | "JUNCTIONBOX" => "444",
        "ELECTRICDISTRIBUTIONBOARD" | "PROTECTIVEDEVICE" => "443",
        "LIGHTFIXTURE" | "LAMP" => "445",
        "ELECTRICGENERATOR" | "SOLARDEVICE" => "442",
        "ALARM" => "456",
        "COMMUNICATIONSAPPLIANCE" => "451",
        "FIRESUPPRESSIONTERMINAL" => "474",
        "TRANSPORTELEMENT" => {
            if pt == "ESCALATOR" || pt == "MOVINGWALKWAY" {
                "462"
            } else {
                "461"
            }
        }
        "SENSOR" | "ACTUATOR" | "CONTROLLER" | "UNITARYCONTROLELEMENT" => "480",
        _ => return None,
    })
}

/// DIN 276 code currently assigned to an object (via IfcRelAssociatesClassification).
pub fn current(doc: &Document, id: u32) -> Option<String> {
    model::classifications_of(doc, id).into_iter().find(|c| c.source.eq_ignore_ascii_case(SYSTEM)).map(|c| c.identification)
}

/// Assign codes (replacing previous DIN 276 classifications of the objects).
/// One classification reference and one relationship per code.
pub fn assign(doc: &mut Document, items: &[(u32, String)]) -> anyhow::Result<usize> {
    if items.is_empty() {
        return Ok(0);
    }
    let objs: rustc_hash::FxHashSet<u32> = items.iter().map(|x| x.0).collect();
    // remove old DIN 276 associations of these objects
    for &o in &objs {
        for c in model::classifications_of(doc, o).into_iter().filter(|c| c.source.eq_ignore_ascii_case(SYSTEM)) {
            let mut a = doc.args(c.rel).unwrap_or_default();
            let l: Vec<u32> = a.get(4).map(|v| v.ref_list()).unwrap_or_default().into_iter().filter(|x| *x != o).collect();
            if l.is_empty() {
                ops::delete_entities(doc, &[c.rel], false)?;
            } else {
                a[4] = Value::List(l.into_iter().map(Value::Ref).collect());
                doc.set_args(c.rel, &a)?;
            }
        }
    }
    let mut by_code: FxHashMap<&str, Vec<u32>> = FxHashMap::default();
    for (o, c) in items {
        by_code.entry(c.as_str()).or_default().push(*o);
    }
    let mut codes: Vec<&str> = by_code.keys().copied().collect();
    codes.sort();
    for code in codes {
        let objects = &by_code[code];
        let name = name_of(code).unwrap_or("");
        ops::assign_classification(doc, objects, SYSTEM, code, name)?;
    }
    Ok(items.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggest_and_assign() {
        let mut doc = ops::new_project(crate::SchemaId::Ifc4, "T", &[("EG".into(), 0.0)]);
        let st = doc.ids_of_type("IFCBUILDINGSTOREY")[0];
        let mk = |doc: &mut Document, class: &str| {
            let spec = ops::NewElement { class_upper: class.into(), name: "x".into(), container: Some(st), location: [0.0; 3], rotation_deg: 0.0, shape: None, predefined_type: None };
            ops::create_element(doc, &spec).unwrap()
        };
        let w = mk(&mut doc, "IFCWALL");
        ops::set_property(&mut doc, w, "Pset_WallCommon", "IsExternal", Value::Typed("IFCBOOLEAN".into(), Box::new(Value::Enum("T".into()))), false).unwrap();
        ops::set_property(&mut doc, w, "Pset_WallCommon", "LoadBearing", Value::Typed("IFCBOOLEAN".into(), Box::new(Value::Enum("T".into()))), false).unwrap();
        let d = mk(&mut doc, "IFCDOOR");
        assert_eq!(suggest(&doc, w), Some("331"));
        assert_eq!(suggest(&doc, d), Some("344"));
        assign(&mut doc, &[(w, "331".into()), (d, "344".into())]).unwrap();
        assert_eq!(current(&doc, w).as_deref(), Some("331"));
        // reassign replaces
        assign(&mut doc, &[(w, "332".into())]).unwrap();
        assert_eq!(current(&doc, w).as_deref(), Some("332"));
        assert_eq!(model::classifications_of(&doc, w).len(), 1);
        assert_eq!(doc.ids_of_type("IFCCLASSIFICATION").len(), 1);
    }
}
