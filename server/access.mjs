// 有料プロバイダーのAPIは、認証基盤がない間は同じ端末からの利用だけを許可する。
// remoteAddress と Host の両方を見ることで、LAN直アクセスと公開リバースプロキシを拒否する。
export function isLocalPaidProviderRequest(remoteAddress, hostHeader) {
  if (!isLoopbackAddress(remoteAddress)) return false;

  try {
    const hostname = new URL(`http://${hostHeader}`).hostname;
    return hostname === "localhost" || hostname.endsWith(".localhost") || isLoopbackAddress(hostname);
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
