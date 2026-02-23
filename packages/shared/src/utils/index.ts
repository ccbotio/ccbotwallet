export function formatAmount(amount: string, decimals = 6): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function truncateAddress(address: string, start = 6, end = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isValidTelegramId(id: string | number): boolean {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;
  return !isNaN(numId) && numId > 0;
}

export function generateNonce(): string {
  return crypto.randomUUID();
}

export function parseTokenAmount(amount: string, decimals = 6): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}

export function formatTokenAmount(amount: bigint, decimals = 6): string {
  const str = amount.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const fraction = str.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
