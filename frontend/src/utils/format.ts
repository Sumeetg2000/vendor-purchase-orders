export function formatMoney(value: string | number): string {
  return Number(value).toFixed(2);
}
