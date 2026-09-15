// Protocol facts: https://gist.github.com/conoro/f0c1d96c450a8f5cce70e2846c3686c4
// Captured Mini fixtures: https://github.com/oliexdev/openScale/issues/71
export type ScaleReading = {
  final: boolean;
  kg: number;
  scaleTimestamp: number;
  raw: string;
};

export function parseYunmaiPacket(hex: string): ScaleReading | null {
  const compact = hex.replace(/[:\s]/g, "");
  if (!/^(?:[0-9a-f]{2})+$/i.test(compact)) return null;
  const bytes = compact.match(/../g)!.map((byte) => parseInt(byte, 16));
  if (bytes.length < 5 || bytes[0] !== 0x0d || bytes[2] !== bytes.length) return null;
  if (bytes.slice(1).reduce((checksum, byte) => checksum ^ byte, 0) !== 0) return null;
  const final = bytes[3] === 2;
  if (bytes[3] === 1 ? bytes.length !== 11 : !final || ![18, 20].includes(bytes.length)) return null;
  const offset = final ? 13 : 8;
  const kg = (bytes[offset] * 256 + bytes[offset + 1]) / 100;
  if (kg <= 0 || kg > 300) return null;
  const timestampOffset = final ? 5 : 4;
  const seconds = bytes.slice(timestampOffset, timestampOffset + 4).reduce((n, byte) => n * 256 + byte, 0);
  return { final, kg, scaleTimestamp: seconds * 1000, raw: compact.toLowerCase() };
}

export function weightInPounds(kg: number): number {
  return Math.round((kg / 0.45359237) * 100) / 100;
}

// Stable across retries and reconnects, using the scale's complete packet.
export function scaleEntryKey(deviceId: string, reading: ScaleReading): string {
  return `yunmai:${deviceId}:${reading.raw}`;
}
