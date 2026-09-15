import { expect, test } from "@jest/globals";
import { parseYunmaiPacket, scaleEntryKey, weightInPounds } from "../yunmaiProtocol";

const live = "0d:1f:0b:01:59:c6:15:2f:26:95:03";
const final = "0d:1f:14:02:00:59:c6:15:2f:23:d0:b6:32:26:95:00:a5:08:f2:37";

test("decodes independently captured Mini live and final readings", () => {
  expect(parseYunmaiPacket(live)).toMatchObject({ final: false, kg: 98.77 });
  expect(parseYunmaiPacket(final)).toMatchObject({ final: true, kg: 98.77, scaleTimestamp: 1506153775000 });
});

test("rejects corruption, truncation, invalid hex and unrelated responses", () => {
  for (const packet of [final.replace("26:95", "26:94"), final.slice(0, -3), "0dzz", "0d1f05051f", "", "d1f"]) {
    expect(parseYunmaiPacket(packet)).toBeNull();
  }
});

test("accepts an older 18-byte final response without requiring body fat", () => {
  const bytes = [0x0d, 0x13, 18, 2, 0, 0x59, 0xc6, 0x15, 0x2f, 0, 0, 0, 1, 0x26, 0x95, 0, 0xa5];
  bytes.push(bytes.slice(1).reduce((a, b) => a ^ b, 0));
  expect(parseYunmaiPacket(bytes.map(b => b.toString(16).padStart(2, "0")).join(""))).toMatchObject({ final: true, kg: 98.77 });
});

test("converts kilograms to the signal's pounds unit and uses stable retry keys", () => {
  expect(weightInPounds(98.77)).toBe(217.75);
  const reading = parseYunmaiPacket(final)!;
  expect(scaleEntryKey("scale", reading)).toBe(scaleEntryKey("scale", { ...reading }));
  expect(scaleEntryKey("another-scale", reading)).not.toBe(scaleEntryKey("scale", reading));
});
