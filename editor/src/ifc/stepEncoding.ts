export function decodeStepString(value = "") {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      result += char;
      continue;
    }

    if (value[index + 1] === "\\") {
      result += "\\";
      index += 1;
      continue;
    }

    const directive = value[index + 1]?.toUpperCase();
    if (directive === "X" && value[index + 2] === "\\") {
      const hex = value.slice(index + 3, index + 5);
      if (/^[0-9A-F]{2}$/i.test(hex)) {
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        continue;
      }
    }

    if (
      directive === "X" &&
      (value[index + 2] === "2" || value[index + 2] === "4") &&
      value[index + 3] === "\\"
    ) {
      const width = value[index + 2] === "2" ? 4 : 8;
      const end = value.toUpperCase().indexOf("\\X0\\", index + 4);
      if (end >= 0) {
        const hex = value.slice(index + 4, end).replace(/\s+/g, "");
        if (hex.length % width === 0 && /^[0-9A-F]*$/i.test(hex)) {
          const chars: string[] = [];
          for (let cursor = 0; cursor < hex.length; cursor += width) {
            const code = Number.parseInt(hex.slice(cursor, cursor + width), 16);
            chars.push(
              width === 4
                ? String.fromCharCode(code)
                : String.fromCodePoint(code),
            );
          }
          result += chars.join("");
          index = end + 3;
          continue;
        }
      }
    }

    if (directive === "S" && value[index + 2] === "\\") {
      const encoded = value[index + 3];
      if (encoded) {
        result += String.fromCharCode(encoded.charCodeAt(0) + 128);
        index += 3;
        continue;
      }
    }

    if (directive === "P" && value[index + 3] === "\\") {
      index += 3;
      continue;
    }

    result += char;
  }
  return result;
}

export function encodeStepString(value = "") {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\") {
      result += "\\\\";
    } else if (code >= 32 && code <= 126) {
      result += char;
    } else if (code <= 0xff) {
      result += `\\X\\${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (code <= 0xffff) {
      result += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    } else {
      result += `\\X4\\${code.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
    }
  }
  return result;
}

export function unquoteStepString(value = "") {
  const trimmed = value.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return undefined;
  }
  return decodeStepString(trimmed.slice(1, -1).replace(/''/g, "'"));
}

export function quoteStepString(value: string) {
  return `'${escapeStepStringContent(value)}'`;
}

export function escapeStepStringContent(value: string) {
  return encodeStepString(value).replace(/'/g, "''");
}

export function decodeStepValue(value = "") {
  return value.replace(
    /'((?:''|[^'])*)'/g,
    (_match, inner: string) =>
      `'${decodeStepString(inner.replace(/''/g, "'"))}'`,
  );
}
