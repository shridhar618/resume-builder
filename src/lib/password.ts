import crypto from "node:crypto";

/**
 * Password hashing compatible with Werkzeug's default format, so accounts created by the
 * original Flask app still sign in:  scrypt:32768:8:1$<salt>$<hex digest>
 */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function scrypt(password: string, salt: string, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEYLEN,
      { N: n, r, p, maxmem: 132 * n * r * p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

function randomSalt(len = 16): string {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => SALT_CHARS[b % SALT_CHARS.length]).join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomSalt();
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt:${N}:${R}:${P}$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [method, salt, hex] = stored.split("$");
  if (!method || !salt || !hex) return false;
  const [name, n, r, p] = method.split(":");
  if (name !== "scrypt") return false;
  const key = await scrypt(password, salt, Number(n) || N, Number(r) || R, Number(p) || P);
  const expected = Buffer.from(hex, "hex");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain at least one letter and one number.";
  return null;
}

// Constant hash used to equalise timing when the email doesn't exist.
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
}
