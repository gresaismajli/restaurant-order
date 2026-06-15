const crypto = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
}

function makePassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

function verifyPassword(password, user) {
  if (!user || !user.password || !user.password.salt || !user.password.hash) return false;
  const expected = Buffer.from(user.password.hash, "hex");
  const actual = Buffer.from(hashPassword(password, user.password.salt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { nowIso, uid, money, makePassword, verifyPassword };
