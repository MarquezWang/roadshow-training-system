const FALLBACK_PATH = "/projects";

function containsUnsafeCharacters(value) {
  if (/[\\\u0000-\u001f\u007f]/.test(value) || /%5c/i.test(value)) {
    return true;
  }

  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return true;
    }

    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) {
      return true;
    }
  }

  return false;
}

export function getSafeInternalPath(value, fallback = FALLBACK_PATH) {
  const candidate = String(value ?? fallback).trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    containsUnsafeCharacters(candidate)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://roadshow.invalid");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) {
      return fallback;
    }

    if (
      parsed.pathname === "/login" ||
      parsed.pathname.startsWith("/login/") ||
      parsed.pathname === "/logout" ||
      parsed.pathname.startsWith("/logout/")
    ) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
