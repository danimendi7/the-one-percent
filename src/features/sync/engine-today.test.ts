import { describe, expect, it } from "vitest"
import { memoryStorage, SyncEngine } from "./engine"
import { FakeServer, fakeTransport } from "./testing/fake-server"

/**
 * F2 · «Today» follows the server's clock once the engine has heard from it. A phone three hours
 * behind, just after midnight in Madrid, used to show (and write) the day before (PR #15).
 */
const SERVER_NOW = Date.parse("2026-10-21T22:30:00Z") // 00:30 on Thursday 22 Oct in Madrid (CEST)

function engineAt(deviceNow: number) {
  const server = new FakeServer("2026-10-22", () => SERVER_NOW)
  return new SyncEngine({ transport: fakeTransport(server), storage: memoryStorage(), deviceId: "dev-a", now: () => deviceNow, schedule: () => () => {} })
}

describe("SyncEngine · today", () => {
  it("a device clock hours behind sees the server's day once it has synced", async () => {
    const engine = engineAt(SERVER_NOW - 3 * 3_600_000) // the phone says 21:30 on the 21st
    expect(engine.getSnapshot().today).toBe("2026-10-21") // before any answer: the device clock alone
    await engine.start()
    await engine.sync()
    expect(engine.getSnapshot().today).toBe("2026-10-22")
    expect(engine.diagnostics().clockOffsetMs).toBe(3 * 3_600_000)
  })

  it("a device clock that is right changes nothing", async () => {
    const engine = engineAt(SERVER_NOW)
    expect(engine.getSnapshot().today).toBe("2026-10-22")
    await engine.start()
    await engine.sync()
    expect(engine.getSnapshot().today).toBe("2026-10-22")
  })

  it("a device clock hours ahead does not jump to tomorrow either", async () => {
    const engine = engineAt(SERVER_NOW - 2 * 3_600_000 + 26 * 3_600_000) // a day and a bit ahead
    await engine.start()
    await engine.sync()
    expect(engine.getSnapshot().today).toBe("2026-10-22")
  })
})
