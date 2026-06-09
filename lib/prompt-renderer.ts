function stringifyVariable(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function readVariable(
  variables: Record<string, unknown>,
  path: string,
): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (
      current &&
      typeof current === "object" &&
      Object.prototype.hasOwnProperty.call(current, key)
    ) {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, variables);
}

export function renderPrompt(
  template: string,
  variables: Record<string, unknown>,
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = readVariable(variables, key);

    if (value === undefined) {
      return match;
    }

    return stringifyVariable(value);
  });
}
