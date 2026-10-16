import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashPassword(password, salt = randomBytes(24).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
export async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.PasswordSalt);
  const expected = Buffer.from(user.PasswordHash, 'hex');
  return expected.length === 64 && timingSafeEqual(Buffer.from(hash, 'hex'), expected);
}
