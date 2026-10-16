export const RETURN_COLORS = {
  lossStrong: "#dc2626",
  lossMedium: "#991b1b",
  lossMild: "#5f1d1d",
  flat: "#475569",
  gainMild: "#164e2b",
  gainMedium: "#166534",
  gainStrong: "#16a34a",
} as const;

export const RETURN_LEGEND = [
  { label: "< -5%", color: RETURN_COLORS.lossStrong },
  { label: "-5 to -1%", color: RETURN_COLORS.lossMedium },
  { label: "-1 to -0.1%", color: RETURN_COLORS.lossMild },
  { label: "Flat", color: RETURN_COLORS.flat },
  { label: "0.1 to 1%", color: RETURN_COLORS.gainMild },
  { label: "1 to 5%", color: RETURN_COLORS.gainMedium },
  { label: "> 5%", color: RETURN_COLORS.gainStrong },
] as const;

export function colorForReturn(value: number | null): string {
  if (value === null || Math.abs(value) < 0.1) return RETURN_COLORS.flat;
  if (value < -5) return RETURN_COLORS.lossStrong;
  if (value <= -1) return RETURN_COLORS.lossMedium;
  if (value <= -0.1) return RETURN_COLORS.lossMild;
  if (value > 5) return RETURN_COLORS.gainStrong;
  if (value >= 1) return RETURN_COLORS.gainMedium;
  return RETURN_COLORS.gainMild;
}
