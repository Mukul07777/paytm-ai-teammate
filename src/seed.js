// Procedural generator for a synthetic merchant base. Every run produces a different dataset.
const SURNAMES = ['Sharma', 'Gupta', 'Verma', 'Patel', 'Reddy', 'Iyer', 'Khan', 'Singh', 'Joshi', 'Nair', 'Das', 'Mehta', 'Kapoor', 'Rao', 'Bose', 'Pillai', 'Yadav', 'Mishra', 'Shetty', 'Chauhan', 'Arora', 'Menon', 'Qureshi', 'Banerjee'];
const OWNERS = ['Ramesh', 'Suresh', 'Priya', 'Anita', 'Imran', 'Lakshmi', 'Arjun', 'Fatima', 'Vikram', 'Meena', 'Kavita', 'Sanjay', 'Deepa', 'Arif', 'Pooja', 'Gopal', 'Neha', 'Harish', 'Sunita', 'Farhan'];
const KINDS = [['Kirana Store', 'grocery'], ['Electronics', 'electronics'], ['Medicals', 'pharmacy'], ['Sweets', 'food'], ['Tiffin Centre', 'food'], ['Mobiles', 'electronics'], ['Boutique', 'fashion'], ['Hardware', 'hardware'], ['Bakery', 'food'], ['Textiles', 'fashion'], ['General Store', 'grocery'], ['Dhaba', 'food']];
const CITIES = [['Jaipur', 'Hindi'], ['Lucknow', 'Hindi'], ['Indore', 'Hindi'], ['Delhi', 'Hindi'], ['Pune', 'Marathi'], ['Nagpur', 'Marathi'], ['Chennai', 'Tamil'], ['Madurai', 'Tamil'], ['Bengaluru', 'Kannada'], ['Hyderabad', 'Telugu'], ['Kolkata', 'Bengali'], ['Ahmedabad', 'Gujarati'], ['Kochi', 'Malayalam'], ['Amritsar', 'Punjabi']];
const DEVICES = ['Soundbox 4G', 'Soundbox 5.0', 'Card Soundbox', 'EDC Android'];

export const rnd = (a, b) => a + Math.random() * (b - a);
export const ri = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export { SURNAMES, OWNERS };

export function seed(count = 60) {
  const now = Date.now(), DAY = 864e5;
  const merchants = [], devices = [], settlements = [], used = new Set();

  for (let i = 0; i < count; i++) {
    let name, kind;
    do { kind = pick(KINDS); name = `${pick(SURNAMES)} ${kind[0]}`; } while (used.has(name));
    used.add(name);
    const [city, language] = pick(CITIES);
    const base = ri(4000, 60000);
    const trend = Math.random() < 0.22 ? rnd(0.009, 0.016) : rnd(-0.008, 0.008);
    const gmv30 = Array.from({ length: 30 }, (_, d) => Math.round(base * (1 + trend * (d - 29)) * rnd(0.86, 1.14)));
    const id = `MID-${ri(10000, 99999)}`;
    const deviceId = `SB-${ri(10000, 99999)}`;
    merchants.push({
      id, name, owner: pick(OWNERS), city, language, category: kind[1],
      phone: `+91 9${ri(1000, 9999)}X XX${ri(100, 999)}`,
      tenureMonths: ri(3, 84), kycExpiry: now + ri(20, 400) * DAY,
      activeLoan: Math.random() < 0.15, loanConsent: false, creditAppetite: +Math.random().toFixed(2), fallbackAlerts: false,
      gmv30, deviceId
    });
    devices.push({ id: deviceId, merchantId: id, model: pick(DEVICES), status: 'online', lastHeartbeat: now, fault: null, replacementEta: null });
    for (let d = 1; d <= 3; d++) settlements.push({
      id: `STL-${ri(100000, 999999)}`, merchantId: id, amount: gmv30[30 - d], date: now - d * DAY,
      status: 'SETTLED', reason: null, retries: 0, utr: String(ri(1e11, 9e11))
    });
  }

  const fieldAgents = CITIES.flatMap(([city]) => [0, 1].map(() => ({ id: `FA-${ri(1000, 9999)}`, name: `${pick(OWNERS)} ${pick(SURNAMES)[0]}.`, city })));
  const team = [
    { id: 'support', name: `${pick(OWNERS)} ${pick(SURNAMES)[0]}.`, role: 'Support L2', color: '#7A5AF8' },
    { id: 'sales', name: `${pick(OWNERS)} ${pick(SURNAMES)[0]}.`, role: 'Sales Lead', color: '#12B76A' },
    { id: 'risk', name: `${pick(OWNERS)} ${pick(SURNAMES)[0]}.`, role: 'Risk Ops', color: '#F79009' }
  ];

  return {
    meta: { createdAt: now }, settings: { autonomy: 2 },
    merchants, devices, settlements, tickets: [], loans: [], messages: [], handoffs: [],
    missions: [], approvals: [], rules: [], feed: [], team, fieldAgents
  };
}
