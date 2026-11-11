export type DeviceSaveOutcome = "open" | "retry" | "done" | "warn"

/**
 * What to do once the device copy settles. Where the user is gets read after the write: someone who
 * left during the wait has no retry button in front of them, and a refused write must still reach them.
 */
export async function settleDeviceSave(saved: () => Promise<boolean>, stillHere: () => boolean): Promise<DeviceSaveOutcome> {
  const ok = await saved()
  if (stillHere()) return ok ? "open" : "retry"
  return ok ? "done" : "warn"
}
