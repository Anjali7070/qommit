// bech32 checksum validation (BIP-173), same as cli/src/bech32.mjs.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

export function isValidBech32(addr: unknown, prefix = "qor"): boolean {
  if (typeof addr !== "string" || addr !== addr.toLowerCase() || addr.length > 90) return false;
  const sep = addr.lastIndexOf("1");
  if (sep < 1 || sep + 7 > addr.length || addr.slice(0, sep) !== prefix) return false;
  const data: number[] = [];
  for (const c of addr.slice(sep + 1)) {
    const d = CHARSET.indexOf(c);
    if (d === -1) return false;
    data.push(d);
  }
  const hrp = [...prefix].map((c) => c.charCodeAt(0));
  return polymod([...hrp.map((c) => c >>> 5), 0, ...hrp.map((c) => c & 31), ...data]) === 1;
}
