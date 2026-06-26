import { createHash } from "node:crypto";

import type { NativeIfcDocument, NativeIfcEntity } from "../nativeDocument";

/**
 * Version-stable, GlobalId-keyed content hashing for IFC entities.
 *
 * The goal is a hash that stays identical when a file is re-exported (web-ifc
 * re-numbers STEP express ids on every write) but changes whenever the *semantic*
 * content of an entity changes. We achieve that by:
 *
 *  - excluding the volatile express id (`#142`) from the hashed payload, and
 *  - rewriting every `#nnn` reference inside an entity's arguments to a stable
 *    token: the referenced entity's IFC GlobalId when it has one, otherwise a
 *    recursive structural hash of that (GUID-less) support entity.
 *
 * GUID-less support entities (cartesian points, placements, geometry, property
 * values, ...) therefore fold into the hash of the rooted entity that owns them,
 * so e.g. a changed property value or moved point surfaces as a change on its
 * owning IfcPropertySet / IfcProduct.
 */

const REF_PATTERN = /#(\d+)/g;
const MAX_STRUCTURAL_DEPTH = 256;

/** An IFC GlobalId is a 22-character base64 string over [0-9A-Za-z_$]. */
const IFC_GLOBAL_ID_PATTERN = /^[0-9A-Za-z_$]{22}$/;

/**
 * Returns the entity's IFC GlobalId when `args[0]` is a real 22-char IFC GUID.
 *
 * `parseNativeIfcText` naively assigns `globalId = unquote(args[0])` for every
 * entity, so non-rooted entities with a quoted first arg (e.g.
 * `IFCPROPERTYSINGLEVALUE('Height', ...)`) get a bogus "globalId". This guard
 * keeps the manifest and reference linking limited to genuinely rooted entities.
 */
export function ifcGlobalId(entity: NativeIfcEntity): string | null {
  return entity.globalId && IFC_GLOBAL_ID_PATTERN.test(entity.globalId)
    ? entity.globalId
    : null;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

interface HashContext {
  doc: NativeIfcDocument;
  /** structural hash per express id of GUID-less support entities (doc-scoped). */
  structuralCache: Map<number, string>;
}

export function createHashContext(doc: NativeIfcDocument): HashContext {
  return { doc, structuralCache: new Map<number, string>() };
}

function canonicalizeArg(
  arg: string,
  ctx: HashContext,
  stack: Set<number>,
): string {
  return arg.replace(REF_PATTERN, (_match, digits: string) => {
    const token = canonicalRefToken(Number(digits), ctx, stack);
    // Wrap in a control char so a rewritten ref can never be confused with
    // surrounding literal text.
    return `${token}`;
  });
}

function canonicalRefToken(
  refId: number,
  ctx: HashContext,
  stack: Set<number>,
): string {
  const entity = ctx.doc.entityById.get(refId);
  if (!entity) {
    return "MISSING";
  }
  const gid = ifcGlobalId(entity);
  if (gid) {
    return `G:${gid}`;
  }
  if (stack.has(refId)) {
    return "CYCLE";
  }
  if (stack.size > MAX_STRUCTURAL_DEPTH) {
    return "DEPTH";
  }
  return `S:${structuralHash(entity, ctx, stack)}`;
}

function structuralHash(
  entity: NativeIfcEntity,
  ctx: HashContext,
  stack: Set<number>,
): string {
  const cached = ctx.structuralCache.get(entity.id);
  if (cached) {
    return cached;
  }
  stack.add(entity.id);
  const canonicalArgs = entity.args.map((arg) =>
    canonicalizeArg(arg, ctx, stack),
  );
  stack.delete(entity.id);
  const hash = sha256Hex(`${entity.type}(${canonicalArgs.join(",")})`);
  ctx.structuralCache.set(entity.id, hash);
  return hash;
}

/** The canonical, express-id-free payload string that is hashed for an entity. */
export function canonicalEntityPayload(
  entity: NativeIfcEntity,
  ctx: HashContext,
): string {
  const stack = new Set<number>([entity.id]);
  const canonicalArgs = entity.args.map((arg) =>
    canonicalizeArg(arg, ctx, stack),
  );
  return `${entity.type}(${canonicalArgs.join(",")})`;
}

/** Version-stable content hash for a single entity. */
export function entityContentHash(
  entity: NativeIfcEntity,
  ctx: HashContext,
): string {
  return sha256Hex(canonicalEntityPayload(entity, ctx));
}
