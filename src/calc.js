export const DAY = 864e5, HOUR = 36e5;
export const sum = a => a.reduce((x, y) => x + y, 0);
export const avg = a => (a.length ? sum(a) / a.length : 0);
export const baseline = m => Math.round(avg(m.gmv30.slice(-7)));
export const growth = m => sum(m.gmv30.slice(-14)) / Math.max(1, sum(m.gmv30.slice(0, 14))) - 1;
export const kycDays = m => Math.ceil((m.kycExpiry - Date.now()) / DAY);
export const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
export const RISK = ['None', 'Low', 'Medium', 'High'];
