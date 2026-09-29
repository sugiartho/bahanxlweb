import type { StorageBackend } from "../storage/types";
import { USER_REFRESH_TOKENS } from "../storage/keys";
import { hashPassword, verifyPassword } from "./password";

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,30}$/;

export interface WebuiUserRecord {
  username: string;
  password_hash: string;
  created_at: number;
  theme?: string;
  telegram_chat_id?: number | null;
  email?: string | null;
  google_sub?: string | null;
  google_email?: string | null;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export async function loadUsers(storage: StorageBackend): Promise<WebuiUserRecord[]> {
  return (await storage.loadUsers()) as WebuiUserRecord[];
}

export async function getUser(storage: StorageBackend, username: string): Promise<WebuiUserRecord | null> {
  const normalized = (username || "").toLowerCase().trim();
  for (const u of await loadUsers(storage)) {
    if (u.username.toLowerCase() === normalized) return u;
  }
  return null;
}

export async function getUserByGoogleSub(
  storage: StorageBackend,
  googleSub: string,
): Promise<WebuiUserRecord | null> {
  return storage.findUserByGoogleSub(googleSub);
}

export function hasPasswordLogin(user: WebuiUserRecord | null | undefined): boolean {
  return Boolean(user?.password_hash?.trim());
}

export function hasGoogleLogin(user: WebuiUserRecord | null | undefined): boolean {
  return Boolean(user?.google_sub?.trim());
}

export async function authenticate(
  storage: StorageBackend,
  username: string,
  password: string,
): Promise<WebuiUserRecord | null> {
  const user = await getUser(storage, username);
  if (!user || !hasPasswordLogin(user)) return null;
  if (!(await verifyPassword(password, user.password_hash))) return null;
  return user;
}

async function allocateUsername(storage: StorageBackend, email: string, googleSub: string): Promise<string> {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!base || !/^[a-z0-9]/.test(base)) {
    base = `u${googleSub.replace(/\D/g, "").slice(0, 12)}`;
  }
  if (base.length < 3) base = `${base}usr`;
  base = base.slice(0, 24);

  let suffix = 0;
  let candidate = base;
  if (!USERNAME_RE.test(candidate)) candidate = `u${googleSub.replace(/\D/g, "").slice(0, 8)}`;
  while (await getUser(storage, candidate)) {
    suffix += 1;
    candidate = `${base.slice(0, 20)}${suffix}`;
    if (!USERNAME_RE.test(candidate)) candidate = `u${googleSub.replace(/\D/g, "").slice(0, 6)}${suffix}`;
  }
  return candidate;
}

export async function createGoogleUser(
  storage: StorageBackend,
  profile: GoogleProfile,
): Promise<{ ok: true; user: WebuiUserRecord } | { ok: false; error: string }> {
  if (await getUserByGoogleSub(storage, profile.sub)) {
    return { ok: false, error: "Akun Google sudah terdaftar." };
  }

  const username = await allocateUsername(storage, profile.email, profile.sub);
  const users = await loadUsers(storage);
  const user: WebuiUserRecord = {
    username,
    password_hash: "",
    created_at: Math.floor(Date.now() / 1000),
    email: profile.email,
    google_sub: profile.sub,
    google_email: profile.email,
  };
  users.push(user);
  await storage.saveUsers(users);
  await ensureUserBootstrap(storage, username);
  return { ok: true, user };
}

export async function linkGoogleAccount(
  storage: StorageBackend,
  username: string,
  profile: GoogleProfile,
): Promise<{ ok: true; user: WebuiUserRecord } | { ok: false; error: string }> {
  const normalized = (username || "").toLowerCase().trim();
  const existingBySub = await getUserByGoogleSub(storage, profile.sub);
  if (existingBySub && existingBySub.username !== normalized) {
    return { ok: false, error: "Akun Google sudah terhubung ke user lain." };
  }

  const users = await loadUsers(storage);
  let found: WebuiUserRecord | null = null;
  for (const u of users) {
    if (u.username.toLowerCase() === normalized) {
      u.google_sub = profile.sub;
      u.google_email = profile.email;
      if (!u.email) u.email = profile.email;
      found = u;
      break;
    }
  }
  if (!found) return { ok: false, error: "User tidak ditemukan." };
  await storage.saveUsers(users);
  return { ok: true, user: found };
}

export async function createUser(
  storage: StorageBackend,
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = (username || "").toLowerCase().trim();
  if (!USERNAME_RE.test(normalized)) {
    return { ok: false, error: "Username: 3-31 char, huruf kecil/angka/_/-, awalan huruf/angka." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Password minimal 6 karakter." };
  }
  if (await getUser(storage, normalized)) {
    return { ok: false, error: `Username '${normalized}' sudah dipakai.` };
  }

  const users = await loadUsers(storage);
  users.push({
    username: normalized,
    password_hash: await hashPassword(password),
    created_at: Math.floor(Date.now() / 1000),
  });
  await storage.saveUsers(users);
  await storage.ensureUserDir(normalized);
  await ensureUserBootstrap(storage, normalized);
  return { ok: true };
}

export async function ensureUserBootstrap(storage: StorageBackend, username: string): Promise<void> {
  if (!(await storage.blobExists(username, USER_REFRESH_TOKENS))) {
    await storage.putBlob(username, USER_REFRESH_TOKENS, "[]");
  }
  await storage.ensureUserDir(username);
}

export function getTheme(user: WebuiUserRecord | null | undefined): string {
  return user?.theme === "light" ? "light" : "dark";
}

export async function getUserByTelegram(
  storage: StorageBackend,
  chatId: number,
): Promise<WebuiUserRecord | null> {
  return storage.findUserByTelegramChatId(chatId);
}

export async function linkTelegram(
  storage: StorageBackend,
  username: string,
  chatId: number,
): Promise<boolean> {
  const users = await loadUsers(storage);
  const normalized = (username || "").toLowerCase().trim();
  let found = false;
  for (const u of users) {
    if (u.telegram_chat_id === chatId && u.username.toLowerCase() !== normalized) {
      delete u.telegram_chat_id;
    }
    if (u.username.toLowerCase() === normalized) {
      u.telegram_chat_id = chatId;
      found = true;
    }
  }
  if (!found) return false;
  await storage.saveUsers(users);
  return true;
}

export async function unlinkTelegram(storage: StorageBackend, username: string): Promise<boolean> {
  const users = await loadUsers(storage);
  const normalized = (username || "").toLowerCase().trim();
  let found = false;
  for (const u of users) {
    if (u.username.toLowerCase() === normalized) {
      delete u.telegram_chat_id;
      found = true;
    }
  }
  if (!found) return false;
  await storage.saveUsers(users);
  return true;
}

export async function changePassword(
  storage: StorageBackend,
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await authenticate(storage, username, currentPassword);
  if (!user) return { ok: false, error: "Password lama salah." };
  if (newPassword.length < 6) {
    return { ok: false, error: "Password baru minimal 6 karakter." };
  }

  const users = await loadUsers(storage);
  const normalized = (username || "").toLowerCase().trim();
  for (const u of users) {
    if (u.username.toLowerCase() === normalized) {
      u.password_hash = await hashPassword(newPassword);
      await storage.saveUsers(users);
      return { ok: true };
    }
  }
  return { ok: false, error: "User tidak ditemukan." };
}

export async function setInitialPassword(
  storage: StorageBackend,
  username: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 6) {
    return { ok: false, error: "Password minimal 6 karakter." };
  }
  const users = await loadUsers(storage);
  const normalized = (username || "").toLowerCase().trim();
  for (const u of users) {
    if (u.username.toLowerCase() === normalized) {
      if (hasPasswordLogin(u)) return { ok: false, error: "Password sudah di-set." };
      u.password_hash = await hashPassword(newPassword);
      await storage.saveUsers(users);
      return { ok: true };
    }
  }
  return { ok: false, error: "User tidak ditemukan." };
}

export async function setTheme(
  storage: StorageBackend,
  username: string,
  theme: string,
): Promise<boolean> {
  if (theme !== "dark" && theme !== "light") return false;
  const users = await loadUsers(storage);
  const normalized = (username || "").toLowerCase().trim();
  for (const u of users) {
    if (u.username.toLowerCase() === normalized) {
      u.theme = theme;
      await storage.saveUsers(users);
      return true;
    }
  }
  return false;
}