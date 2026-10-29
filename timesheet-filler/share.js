// Cost center splits travel as a link: <time card url>#tsf=<base64url JSON>. The part after "#" is never
// sent to the server, and the receiving side only ever shows it for confirmation before applying.
const Share = (() => {
  const LINK_BASE = "https://corp.go.paylocity.com/time/time-card";
  const MAX_COST_CENTERS = 10;
  const MAX_TEXT = 120;

  const toBase64Url = (text) => {
    let binary = "";
    new TextEncoder().encode(text).forEach((byte) => (binary += String.fromCharCode(byte)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromBase64Url = (code) => {
    const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
  };

  // split: { names: string[], percents: number[], label?: string }
  const link = ({ names, percents, label }) => {
    const payload = { v: 1, c: names, p: percents, ...(label ? { m: label } : {}) };
    return `${LINK_BASE}#tsf=${toBase64Url(JSON.stringify(payload))}`;
  };

  // Accepts a full link, "#tsf=..." or the bare code; returns { names, percents, label } or null.
  const decode = (text) => {
    try {
      const match = String(text).match(/tsf=([A-Za-z0-9_-]+)/);
      const data = JSON.parse(fromBase64Url(match ? match[1] : String(text).trim()));
      const { c: names, p: percents, m: label } = data;
      const valid =
        data.v === 1 &&
        Array.isArray(names) && Array.isArray(percents) &&
        names.length >= 1 && names.length <= MAX_COST_CENTERS && names.length === percents.length &&
        names.every((name) => typeof name === "string" && name.trim() && name.length <= MAX_TEXT) &&
        percents.every((p) => typeof p === "number" && p >= 0 && p <= 100) &&
        percents.reduce((a, b) => a + b, 0) === 100;
      if (!valid) return null;
      return { names: names.map((name) => name.trim()), percents, label: typeof label === "string" ? label.slice(0, MAX_TEXT) : "" };
    } catch {
      return null;
    }
  };

  const codeFromHash = (hash) => {
    const match = String(hash).match(/tsf=([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  };

  return { link, decode, codeFromHash };
})();
