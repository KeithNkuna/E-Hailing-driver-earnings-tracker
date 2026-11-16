// Optional Supabase cloud connection credentials for multi-phone sync
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

const STORAGE_KEY = 'tmn_uber_fleet_logs_v1';
const DRIVERS_KEY = 'tmn_fleet_drivers_v1';
const CARS_KEY = 'tmn_fleet_cars_v1';

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

// Smart Default Burn Rate by Car Model (Petrol Cost as % of Gross Fares)
function getDefaultBurnRateForModel(modelName) {
  const m = (modelName || '').toLowerCase();
  if (m.includes('magnite') || m.includes('kwid') || m.includes('swift') || m.includes('celerio') || m.includes('picanto') || m.includes('i10') || m.includes('vitz')) {
    return 0.25; // Economical 1.0L - 1.2L compact cars (~R250 petrol per R1000 gross)
  }
  if (m.includes('polo') || m.includes('corolla') || m.includes('quest') || m.includes('accent') || m.includes('rio') || m.includes('baleno')) {
    return 0.29; // Standard 1.4L - 1.6L sedans/hatchbacks
  }
  if (m.includes('suv') || m.includes('fortuner') || m.includes('x-trail') || m.includes('tiguan') || m.includes('2.0')) {
    return 0.36; // Larger engines
  }
  return 0.28; // General e-hailing baseline
}

// Manage Fleet Vehicles (Model, Registration, Full Tank Rands)
function getCars() {
  return JSON.parse(localStorage.getItem(CARS_KEY) || '[]');
}

function addCar(model, reg, fullTankZar) {
  const cleanModel = (model || '').trim();
  const cleanReg = (reg || '').trim().toUpperCase();
  const tank = Number(fullTankZar || 900);
  if (!cleanModel || !cleanReg || tank <= 0) return false;

  const cars = getCars();
  const existingIdx = cars.findIndex(c => c.reg === cleanReg);
  const carObj = {
    model: cleanModel,
    reg: cleanReg,
    fullTankZar: tank,
    baseBurnRate: getDefaultBurnRateForModel(cleanModel)
  };

  if (existingIdx >= 0) {
    cars[existingIdx] = carObj;
  } else {
    cars.push(carObj);
  }
  localStorage.setItem(CARS_KEY, JSON.stringify(cars));
  return true;
}

function removeCar(reg) {
  const cars = getCars().filter(c => c.reg !== reg);
  localStorage.setItem(CARS_KEY, JSON.stringify(cars));
}

// Fetch all shift entries
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

// AI Fuel Estimator per Specific Vehicle Registration
function estimateFuelForCar(allLogs, carReg) {
  const cars = getCars();
  const car = cars.find(c => c.reg === carReg) || {
    model: 'Default Vehicle',
    reg: carReg || 'UNASSIGNED',
    fullTankZar: 900,
    baseBurnRate: 0.25
  };

  // Filter shifts strictly for this vehicle registration
  const carLogs = allLogs.filter(l => l.car_reg === car.reg);

  let totalGross = 0;
  let totalPetrol = 0;
  carLogs.forEach(l => {
    totalGross += Number(l.app_earnings || 0) + Number(l.cash_collected || 0);
    totalPetrol += Number(l.petrol_cost || 0);
  });

  // Blend model baseline with real-world logged shifts once enough data exists
  const burnRate = (totalGross > 1500 && totalPetrol > 0)
    ? Math.min(Math.max(totalPetrol / totalGross, 0.14), 0.55)
    : car.baseBurnRate;

  // Replay shifts chronologically to track remaining fuel value in this car's tank
  const chronological = [...carLogs].reverse();
  let remainingZar = 0;

  chronological.forEach(l => {
    const shiftGross = Number(l.app_earnings || 0) + Number(l.cash_collected || 0);
    const addedPetrol = Number(l.petrol_cost || 0);

    remainingZar += addedPetrol;
    if (remainingZar > car.fullTankZar) remainingZar = car.fullTankZar;

    const estimatedBurn = shiftGross * burnRate;
    remainingZar = Math.max(0, remainingZar - estimatedBurn);
  });

  const percentage = Math.min(100, Math.round((remainingZar / car.fullTankZar) * 100));
  return {
    car,
    remainingZar,
    fullTankZar: car.fullTankZar,
    percentage,
    burnRatePercent: Math.round(burnRate * 100)
  };
}
