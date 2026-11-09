import { describe, expect, it } from "vitest"
import { settleDeviceSave } from "./device-save-flow"

describe("settleDeviceSave", () => {
  it("opens what was saved while the user is still there", async () => {
    expect(await settleDeviceSave(async () => true, () => true)).toBe("open")
  })

  it("offers a retry when the device refuses and the user is still there", async () => {
    expect(await settleDeviceSave(async () => false, () => true)).toBe("retry")
  })

  it("does nothing more when it was saved and the user already left", async () => {
    expect(await settleDeviceSave(async () => true, () => false)).toBe("done")
  })

  it("warns when the device refuses and nobody is there to retry", async () => {
    expect(await settleDeviceSave(async () => false, () => false)).toBe("warn")
  })

  it("looks at where the user is only after the write settles: leaving during the wait still warns", async () => {
    let here = true
    let refuse: (ok: boolean) => void = () => undefined
    const outcome = settleDeviceSave(() => new Promise<boolean>((resolve) => (refuse = resolve)), () => here)
    here = false
    refuse(false)
    expect(await outcome).toBe("warn")
  })
})
