#!/usr/bin/env python3
"""Generate compact IFC schema tables (IFC2X3, IFC4, IFC4X3) for ifc-doc.

Input: a TypeScript declaration listing of the official IFC EXPRESS schemas
(for example `ifc-schema.d.ts` from the web-ifc npm package, used purely as a
machine readable schema listing). Output: `crates/ifc-doc/src/schema/*.txt`,
a small line based format parsed at runtime:

  S <schema>
  T <TypeName> <primitive>          defined type (string|number|boolean|...)
  N <EnumName> V1 V2 ...            enumeration
  E <Entity> <Parent|-> <n_own>     entity, followed by n_own own attributes
  A <Name> <flags> <TypeName>       flags: o=optional r=reference l=list, '-' none

Usage: gen_schema.py <ifc-schema.d.ts> <out_dir>
"""
import os
import re
import sys


def split_params(text: str) -> list:
    out, depth, cur = [], 0, []
    for ch in text:
        if ch in "(<[":
            depth += 1
        elif ch in ")>]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def main() -> None:
    src = open(sys.argv[1], encoding="utf-8").read()
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    ns_re = re.compile(r"export declare namespace (IFC2X3|IFC4|IFC4X3) \{")
    starts = [(m.group(1), m.end()) for m in ns_re.finditer(src)]
    for i, (name, start) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(src)
        body = src[start:end]
        lines = [f"S {name}"]
        entities = {}
        order = []
        for m in re.finditer(r"\n    class (\w+)(?: extends (\w+))? \{\n(.*?)\n    \}", body, re.S):
            cname, parent, cbody = m.group(1), m.group(2), m.group(3)
            statics = re.findall(r"static (\w+): any;", cbody)
            if statics and "constructor" not in cbody:
                lines.append("N " + cname + " " + " ".join(statics))
                continue
            vm = re.search(r"\n        value: ([\w\[\]]+)", "\n" + cbody)
            if vm and "constructor(v" in cbody and not parent:
                lines.append(f"T {cname} {vm.group(1)}")
                continue
            if not cname.startswith("Ifc"):
                continue
            attrs = []
            cm = re.search(r"\n        constructor\((.*)\);", "\n" + cbody)
            params = split_params(cm.group(1)) if cm else []
            for param in params:
                aname, _, atype = param.partition(":")
                aname, atype = aname.strip(), atype.strip()
                if not aname or aname in ("type", "expressID"):
                    continue
                optional = atype.endswith("| null")
                t = atype[:-6].strip() if optional else atype.strip()
                is_list = t.endswith("[]")
                is_ref = "Handle<" in t
                hm = re.search(r"Handle<(\w+)>", t)
                if hm:
                    base = hm.group(1)
                else:
                    base = re.sub(r"[\[\]\(\)]", "", t).split("|")[0].strip()
                flags = ("o" if optional else "") + ("r" if is_ref else "") + ("l" if is_list else "")
                attrs.append((aname, flags or "-", base or "?"))
            entities[cname] = (parent, attrs)
            order.append(cname)
        full = {}

        def full_attrs(cname):
            if cname in full:
                return full[cname]
            parent, attrs = entities[cname]
            if parent and parent in entities:
                pfull = full_attrs(parent)
                pnames = {a[0] for a in pfull}
                res = list(pfull) + [a for a in attrs if a[0] not in pnames]
            else:
                res = list(attrs)
            full[cname] = res
            return res

        for cname in order:
            parent, _ = entities[cname]
            own = full_attrs(cname)
            if parent and parent in entities:
                own = own[len(full_attrs(parent)):]
            ptxt = parent if parent and parent in entities else "-"
            lines.append(f"E {cname} {ptxt} {len(own)}")
            for a in own:
                lines.append(f"A {a[0]} {a[1]} {a[2]}")
        with open(os.path.join(out_dir, name.lower() + ".txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(name, "entities", len(order), "lines", len(lines))


if __name__ == "__main__":
    main()
