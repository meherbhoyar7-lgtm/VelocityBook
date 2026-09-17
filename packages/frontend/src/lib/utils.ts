export function formatPrice(price: string | number, decimals: number = 2, currency: string = 'INR'): string {
  const locale = currency === 'USD' ? 'en-US' : 'en-IN';
  return Number(price).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}


export function formatQuantity(qty: string | number, decimals: number = 4): string {
  return Number(qty).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatTime(timestamp: string | number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export function formatDateTime(timestamp: string | number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', { hour12: false });
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
