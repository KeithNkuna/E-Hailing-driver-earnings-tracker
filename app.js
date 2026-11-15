// Optional Supabase cloud connection credentials for multi-phone sync
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

const STORAGE_KEY = 'tmn_uber_fleet_logs_v1';
const TANK_CAPACITY_KEY = 'tmn_tank_capacity_zar';
const DRIVERS_KEY = 'tmn_fleet_drivers_v1';

// Format South African Rand
function formatZAR(amount) {
  return 'R ' + Number(amount || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Manage Dynamic Drivers List
function getDrivers() {
  return JSON.parse(localStorage.getItem(DRIVERS_KEY) || '[]');
}

function addDriver(name) {
  const cleanName = name.trim();
  if (!cleanName) return false;
  const drivers = getDrivers();
  if (!drivers.includes(cleanName)) {
    drivers.push(cleanName);
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
  }
  return true;
}

function removeDriver(name) {
  const drivers = getDrivers().filter(d => d !== name);
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
}

// Fetch all shift entries (with local storage fallback)
async function getLogs() {
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await client.from('fleet_logs').select('*').order('shift_date', { ascending: false });
    if (!error && data) return data;
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

// Save a new shift entry
async function saveLog(entry) {
  if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase) {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await client.from('fleet_logs').insert([entry]);
    if (error) {
      alert('Error saving to cloud: ' + error.message);
      return false;
    }
    return true;
  }
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  entry.id = Date.now();
  existing.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return true;
}

// Filter logs by timeframe
function filterByTimeframe(logs, timeframe) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return logs.filter(item => {
    if (timeframe === 'all') return true;
    const itemDate = new Date(item.shift_date);
    if (timeframe === 'day') return item.shift_date === todayStr;
    if (timeframe === 'week') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      return itemDate >= sevenDaysAgo;
    }
    if (timeframe === 'month') {
      return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
    }
    return true;
  });
}

// AI Fuel Estimator based on historical Petrol-to-Earnings ratio
function estimateFuelStatus(logs) {
  const fullTankZar = Number(localStorage.getItem(TANK_CAPACITY_KEY) || 950);

  let totalGross = 0;
  let totalPetrol = 0;
  logs.forEach(l => {
    totalGross += Number(l.app_earnings || 0) + Number(l.cash_collected || 0);
    totalPetrol += Number(l.petrol_cost || 0);
  });

  // Default 28% burn rate until enough shifts are logged to learn your car's actual rate
  const burnRate = (totalGross > 200 && totalPetrol > 0)
    ? Math.min(Math.max(totalPetrol / totalGross, 0.12), 0.65)
    : 0.28;

  // Replay shifts chronologically to track remaining fuel value in tank
  const chronological = [...logs].reverse();
  let remainingZar = 0;

  chronological.forEach(l => {
    const shiftGross = Number(l.app_earnings || 0) + Number(l.cash_collected || 0);
    const addedPetrol = Number(l.petrol_cost || 0);

    remainingZar += addedPetrol;
    if (remainingZar > fullTankZar) remainingZar = fullTankZar;

    const estimatedBurn = shiftGross * burnRate;
    remainingZar = Math.max(0, remainingZar - estimatedBurn);
  });

  const percentage = Math.min(100, Math.round((remainingZar / fullTankZar) * 100));
  return {
    remainingZar,
    fullTankZar,
    percentage,
    burnRatePercent: Math.round(burnRate * 100)
  };
}
