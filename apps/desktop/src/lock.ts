// App idle-lock: a local PIN gate over the visible UI (does not replace the
// daemon token — it stops someone at the machine from browsing secrets in an
// unattended window). PIN is stored only as a SHA-256 hash.
const LS_PIN = "agentpass.pin";
const LS_MIN = "agentpass.lockMin";

export const hasPin = (): boolean => !!localStorage.getItem(LS_PIN);

async function hash(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setPin(pin: string): Promise<void> {
  localStorage.setItem(LS_PIN, await hash(pin));
}
export function clearPin(): void {
  localStorage.removeItem(LS_PIN);
}
export async function verifyPin(pin: string): Promise<boolean> {
  return localStorage.getItem(LS_PIN) === (await hash(pin));
}
export const lockMinutes = (): number => Number(localStorage.getItem(LS_MIN) || 10);
export const setLockMinutes = (m: number): void => localStorage.setItem(LS_MIN, String(m));
