import bcrypt from "bcryptjs";

export async function hashPassword(raw: string, saltRound: number) {
  return bcrypt.hash(raw, saltRound);
}

export async function comparePassword(raw: string, hash: string) {
  return bcrypt.compare(raw, hash);
}