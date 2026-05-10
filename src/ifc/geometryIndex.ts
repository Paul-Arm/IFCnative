import type * as WebIFC from 'web-ifc';

import type { IfcDiagnostic, IfcEntitySummary, IfcGeometryIndex, IfcGeometryPiece } from './types';

export function buildGeometryIndex(
  api: WebIFC.IfcAPI,
  modelID: number,
  entitiesByID: Map<number, IfcEntitySummary>,
): IfcGeometryIndex {
  const diagnostics: IfcDiagnostic[] = [];
  const pieces: IfcGeometryPiece[] = [];
  const byExpressID = new Map<number, IfcGeometryPiece[]>();
  const typeCounter = new Map<string, number>();
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  try {
    api.StreamAllMeshes(modelID, (mesh) => {
      const summary = entitiesByID.get(mesh.expressID);
      const typeName = summary?.typeName ?? 'IFCPRODUCT';
      typeCounter.set(typeName, (typeCounter.get(typeName) ?? 0) + 1);

      for (let index = 0; index < mesh.geometries.size(); index += 1) {
        const placed = mesh.geometries.get(index);
        const geometry = api.GetGeometry(modelID, placed.geometryExpressID);
        const vertexData = api.GetVertexArray(
          geometry.GetVertexData(),
          geometry.GetVertexDataSize(),
        );
        const indexData = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const { positions, normals } = splitVertexData(vertexData);
        const matrix = Array.from(placed.flatTransformation ?? identityMatrix());
        updateBounds(positions, matrix, min, max);

        const piece: IfcGeometryPiece = {
          expressID: mesh.expressID,
          typeName,
          geometryExpressID: placed.geometryExpressID,
          color: [
            placed.color?.x ?? 0.45,
            placed.color?.y ?? 0.55,
            placed.color?.z ?? 0.65,
            placed.color?.w ?? 1,
          ],
          matrix,
          positions,
          normals,
          indices: new Uint32Array(indexData),
        };
        pieces.push(piece);
        byExpressID.set(mesh.expressID, [...(byExpressID.get(mesh.expressID) ?? []), piece]);
        geometry.delete();
      }
    });
  } catch (error) {
    diagnostics.push({
      code: 'GEOMETRY_STREAM_FAILED',
      severity: 'warning',
      message: `Geometry stream failed: ${String(error)}`,
    });
  }

  return {
    pieces,
    byExpressID,
    typeCounts: Array.from(typeCounter.entries())
      .map(([typeName, count]) => ({ typeName, count }))
      .sort((left, right) => right.count - left.count),
    bounds: pieces.length > 0 ? boundsFromMinMax(min, max) : undefined,
    diagnostics,
  };
}

function splitVertexData(vertexData: Float32Array) {
  const stride = vertexData.length % 6 === 0 ? 6 : 3;
  const vertexCount = vertexData.length / stride;
  const positions = new Float32Array(vertexCount * 3);
  const normals = stride === 6 ? new Float32Array(vertexCount * 3) : undefined;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    positions[vertex * 3] = vertexData[vertex * stride];
    positions[vertex * 3 + 1] = vertexData[vertex * stride + 1];
    positions[vertex * 3 + 2] = vertexData[vertex * stride + 2];
    if (normals) {
      normals[vertex * 3] = vertexData[vertex * stride + 3];
      normals[vertex * 3 + 1] = vertexData[vertex * stride + 4];
      normals[vertex * 3 + 2] = vertexData[vertex * stride + 5];
    }
  }

  return { positions, normals };
}

function updateBounds(
  positions: Float32Array,
  matrix: number[],
  min: [number, number, number],
  max: [number, number, number],
) {
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    const tx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const ty = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const tz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    min[0] = Math.min(min[0], tx);
    min[1] = Math.min(min[1], ty);
    min[2] = Math.min(min[2], tz);
    max[0] = Math.max(max[0], tx);
    max[1] = Math.max(max[1], ty);
    max[2] = Math.max(max[2], tz);
  }
}

function boundsFromMinMax(min: [number, number, number], max: [number, number, number]) {
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius = Math.max(
    Math.hypot(max[0] - center[0], max[1] - center[1], max[2] - center[2]),
    1,
  );
  return { min, max, center, radius };
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
