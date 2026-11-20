import "server-only";
import { cookies } from "next/headers";

/**
 * One-shot messages that survive a redirect (Flask's flash()). Stored in a short-lived,
 * non-HttpOnly cookie so the client <FlashClear> component can delete it once shown.
 */
export const FLASH_COOKIE = "rb_flash";
export type FlashMessage = { type: "success" | "error"; text: string };

export async function flash(type: FlashMessage["type"], text: string) {
  const jar = await cookies();
  const existing = readFlashValue(jar.get(FLASH_COOKIE)?.value);
  jar.set(FLASH_COOKIE, encodeURIComponent(JSON.stringify([...existing, { type, text }])), {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
  });
}

export function readFlashValue(raw: string | undefined): FlashMessage[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(v)
      ? v.filter((m) => m && (m.type === "success" || m.type === "error") && typeof m.text === "string")
      : [];
  } catch {
    return [];
  }
}

export async function getFlashes(): Promise<FlashMessage[]> {
  return readFlashValue((await cookies()).get(FLASH_COOKIE)?.value);
}
