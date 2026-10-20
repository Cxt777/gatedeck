/**
 * 纯 SHA-256 实现（T-M0a-04；FIPS 180-4）。
 *
 * 为什么不用 node:crypto：core 纯度约束禁止任何 `node:*` 依赖（00-开发基准 第六节），
 * 而收据哈希要求跨机器可复算、可与 openssl 互验（同为标准 SHA-256），故在 core 内
 * 提供纯函数实现；外部环境（浏览器/CLI/存储层）复用同一实现，保证链上字节一致。
 *
 * 输入按 UTF-8 编码，输出 64 位小写 hex。实现经过 `eventReceipt.test.ts`
 * 与 node:crypto 的多向量对拍（含多字节中文、跨块长度、56 mod 64 填充边界）。
 *
 * 纯字符串/字节计算，无 IO（core 纯度约束）。
 */

/** 轮常数 K（FIPS 180-4 4.2.3 节，前 64 个素数立方根小数部分前 32 位） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 初始哈希值 H（FIPS 180-4 5.3.3 节，前 8 个素数平方根小数部分前 32 位） */
const INITIAL_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

const utf8 = new TextEncoder();

/** SHA-256（输入字符串，按 UTF-8 编码），返回 64 位小写 hex */
export function sha256Hex(input: string): string {
  return sha256HexBytes(utf8.encode(input));
}

/** SHA-256（原始字节），返回 64 位小写 hex */
export function sha256HexBytes(bytes: Uint8Array): string {
  // 填充：原文 + 0x80 + 补零至 ≡56 (mod 64) + 8 字节大端比特长度
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);

  const h = new Uint32Array(INITIAL_H);
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }

  let out = '';
  for (const word of h) out += word.toString(16).padStart(8, '0');
  return out;
}
