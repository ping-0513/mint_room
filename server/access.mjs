// 有料プロバイダーのAPIは、認証基盤がない間は同じ端末だけに限定する。
export function isLocalPaidProviderRequest(remoteAddress, hostHeader) {
  if (!isLoopbackAddress(remoteAddress)) return false;

  try {
    const hostname = new URL(`http://${hostHeader}`).hostname;
    return hostname === "localhost" || hostname.endsWith(".localhost") || isLoopbackAddress(hostname);
  } catch {
    return false;
  }
}

// JSON以外を拒否すると、外部サイトがpreflightなしで送れる単純POSTを遮断できる。
export function isJSONContentType(contentType) {
  return String(contentType ?? "").split(";", 1)[0].trim().toLowerCase() === "application/json";
}

// ブラウザ由来の有料リクエストは同一Originだけを許し、CLIはOriginなしでも利用できる。
export function isTrustedPaidProviderRequest({
  remoteAddress,
  hostHeader,
  originHeader,
  contentType,
  secFetchSite,
}) {
  if (!isLocalPaidProviderRequest(remoteAddress, hostHeader)) return false;
  if (!isJSONContentType(contentType)) return false;
  if (String(secFetchSite ?? "").trim().toLowerCase() === "cross-site") return false;
  if (originHeader === undefined || originHeader === null || String(originHeader).trim() === "") return true;

  try {
    const requestURL = new URL(`http://${hostHeader}`);
    const originURL = new URL(String(originHeader));
    return originURL.protocol === "http:" && originURL.host === requestURL.host;
  } catch {
    return false;
  }
}

export function isLoopbackAddress(address) {
  let normalized = String(address ?? "").trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) normalized = normalized.slice(7);

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    Number(octets[0]) === 127
  );
}
