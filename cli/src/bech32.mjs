// Minimal bech32 (BIP-173) checksum validation, used to check qor1… addresses.
// An address is "<prefix>1<data><6-char checksum>"; a typo breaks the checksum, so we catch it before it's signed.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

/** Encode raw bytes (e.g. a 20-byte account hash) as a bech32 address with the given prefix. */
export function encodeBech32(hrp, bytes) {
  const data = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) data.push((acc >>> (bits -= 5)) & 31);
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [...Array(6)].map((_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}

/** True if `addr` is a valid bech32 string with the given human-readable prefix (default "qor"). */
export function isValidBech32(addr, prefix = "qor") {
  if (typeof addr !== "string" || addr !== addr.toLowerCase() || addr.length > 90) return false;
  const sep = addr.lastIndexOf("1");
  if (sep < 1 || sep + 7 > addr.length) return false;
  const hrp = addr.slice(0, sep);
  if (hrp !== prefix) return false;
  const data = [];
  for (const c of addr.slice(sep + 1)) {
    const d = CHARSET.indexOf(c);
    if (d === -1) return false;
    data.push(d);
  }
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}
