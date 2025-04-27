/**
 * Volume Profiles Module for LiquiditySim
 * 
 * This module provides functions to generate daily volume profiles for different
 * market scenarios, such as base case (decay), bull case (growth), and bear case
 * (rapid decay with price decline).
 */

/**
 * Generate a base case volume profile with exponential decay
 * 
 * @param {number} days - Number of days to simulate
 * @param {number} initialVolume - Initial daily volume in USD
 * @param {number} finalVolume - Final daily volume in USD (after decay)
 * @param {number} decayDays - Number of days for volume to decay from initial to final
 * @returns {Array} Array of daily volumes in USD
 */
function generateBaseVolumeProfile(days, initialVolume, finalVolume, decayDays) {
  const volumes = [];
  
  // Calculate decay rate for exponential decay
  const decayRate = Math.pow(finalVolume / initialVolume, 1 / decayDays);
  
  for (let day = 1; day <= days; day++) {
    let dailyVolume;
    
    if (day <= decayDays) {
      // Exponential decay from initial to final volume
      dailyVolume = initialVolume * Math.pow(decayRate, day - 1);
    } else {
      // Stable volume after decay period
      dailyVolume = finalVolume;
    }
    
    volumes.push(dailyVolume);
  }
  
  return volumes;
}

/**
 * Generate a bull case volume profile with initial dip and growth
 * 
 * @param {number} days - Number of days to simulate
 * @param {number} initialVolume - Initial daily volume in USD
 * @param {number} dipVolume - Volume at the bottom of the dip in USD
 * @param {number} peakVolume - Peak volume after growth in USD
 * @param {number} initialDays - Days for initial dip
 * @param {number} growthDays - Days for growth from dip to peak
 * @returns {Array} Array of daily volumes in USD
 */
function generateBullVolumeProfile(days, initialVolume, dipVolume, peakVolume, initialDays = 7, growthDays = 30) {
  const volumes = [];
  
  // Calculate decay rate for initial dip
  const dipDecayRate = Math.pow(dipVolume / initialVolume, 1 / initialDays);
  
  // Calculate growth rate after dip
  const growthRate = Math.pow(peakVolume / dipVolume, 1 / growthDays);
  
  for (let day = 1; day <= days; day++) {
    let dailyVolume;
    
    if (day <= initialDays) {
      // Initial decay from launch to lowest point
      dailyVolume = initialVolume * Math.pow(dipDecayRate, day - 1);
    } else if (day <= initialDays + growthDays) {
      // Growth phase
      const growthDay = day - initialDays;
      dailyVolume = dipVolume * Math.pow(growthRate, growthDay);
    } else {
      // Stable at peak volume
      dailyVolume = peakVolume;
    }
    
    volumes.push(dailyVolume);
  }
  
  return volumes;
}

/**
 * Generate a bear case volume profile with rapid decay and price decline
 * 
 * @param {number} days - Number of days to simulate
 * @param {number} initialVolume - Initial daily volume in USD
 * @param {number} finalVolume - Final daily volume in USD (after decay)
 * @param {number} decayDays - Days for rapid volume decay
 * @param {Array} monthlyPriceFactors - Array of monthly price factors (relative to initial price)
 * @returns {Object} Object with volumes array and priceFactors array
 */
function generateBearVolumeProfile(
  days, 
  initialVolume, 
  finalVolume, 
  decayDays = 7,
  monthlyPriceFactors = [0.7, 0.5, 0.3, 0.2, 0.15, 0.1]
) {
  const volumes = [];
  const dailyPriceFactors = [];
  
  // Calculate decay rate for rapid decay
  const decayRate = Math.pow(finalVolume / initialVolume, 1 / decayDays);
  
  for (let day = 1; day <= days; day++) {
    // Calculate volume decay
    let dailyVolume;
    
    if (day <= decayDays) {
      // Rapid decay in first week
      dailyVolume = initialVolume * Math.pow(decayRate, day - 1);
    } else {
      // Stable low volume after rapid decay
      dailyVolume = finalVolume;
    }
    
    // Determine price factor based on which month we're in
    const month = Math.min(Math.floor((day - 1) / 30), monthlyPriceFactors.length - 1);
    const priceFactor = monthlyPriceFactors[month];
    
    // Additional day-to-day price volatility could be added here
    // For now, we use the monthly step function
    
    volumes.push(dailyVolume);
    dailyPriceFactors.push(priceFactor);
  }
  
  return {
    volumes,
    priceFactors: dailyPriceFactors
  };
}

/**
 * Generate a custom volume profile with specified parameters
 * 
 * @param {number} days - Number of days to simulate
 * @param {Object} customParams - Custom parameters for the volume profile
 * @returns {Object} Object with volumes array and optional priceFactors array
 */
function generateCustomVolumeProfile(days, customParams) {
  const {
    initialVolume = 10000000,
    phases = [],
    priceFactors = null
  } = customParams;
  
  // Validate that phases cover the entire period
  const totalPhaseDays = phases.reduce((sum, phase) => sum + phase.days, 0);
  if (totalPhaseDays < days) {
    // Add a final stable phase if needed
    phases.push({
      type: 'stable',
      days: days - totalPhaseDays,
      volume: phases[phases.length - 1]?.targetVolume || initialVolume
    });
  }
  
  const volumes = [];
  const dailyPriceFactors = priceFactors ? [] : null;
  
  let currentDay = 0;
  let lastVolume = initialVolume;
  
  // Process each phase
  for (const phase of phases) {
    if (currentDay >= days) break;
    
    const { type, days: phaseDays } = phase;
    const phaseDaysToUse = Math.min(phaseDays, days - currentDay);
    
    switch (type) {
      case 'decay':
        // Exponential decay
        const decayTo = phase.targetVolume;
        const decayRate = Math.pow(decayTo / lastVolume, 1 / phaseDaysToUse);
        
        for (let i = 0; i < phaseDaysToUse; i++) {
          const volume = lastVolume * Math.pow(decayRate, i);
          volumes.push(volume);
          
          // Handle price factors if provided
          if (dailyPriceFactors !== null && priceFactors) {
            const dayIndex = currentDay + i;
            const month = Math.min(Math.floor(dayIndex / 30), priceFactors.length - 1);
            dailyPriceFactors.push(priceFactors[month]);
          }
        }
        
        lastVolume = decayTo;
        break;
        
      case 'growth':
        // Exponential growth
        const growthTo = phase.targetVolume;
        const growthRate = Math.pow(growthTo / lastVolume, 1 / phaseDaysToUse);
        
        for (let i = 0; i < phaseDaysToUse; i++) {
          const volume = lastVolume * Math.pow(growthRate, i);
          volumes.push(volume);
          
          // Handle price factors if provided
          if (dailyPriceFactors !== null && priceFactors) {
            const dayIndex = currentDay + i;
            const month = Math.min(Math.floor(dayIndex / 30), priceFactors.length - 1);
            dailyPriceFactors.push(priceFactors[month]);
          }
        }
        
        lastVolume = growthTo;
        break;
        
      case 'stable':
        // Stable volume
        const stableVolume = phase.volume || lastVolume;
        
        for (let i = 0; i < phaseDaysToUse; i++) {
          volumes.push(stableVolume);
          
          // Handle price factors if provided
          if (dailyPriceFactors !== null && priceFactors) {
            const dayIndex = currentDay + i;
            const month = Math.min(Math.floor(dayIndex / 30), priceFactors.length - 1);
            dailyPriceFactors.push(priceFactors[month]);
          }
        }
        
        lastVolume = stableVolume;
        break;
        
      case 'custom':
        // Custom daily volumes
        const customVolumes = phase.volumes || [];
        
        for (let i = 0; i < phaseDaysToUse && i < customVolumes.length; i++) {
          volumes.push(customVolumes[i]);
          
          // Handle price factors if provided
          if (dailyPriceFactors !== null && priceFactors) {
            const dayIndex = currentDay + i;
            const month = Math.min(Math.floor(dayIndex / 30), priceFactors.length - 1);
            dailyPriceFactors.push(priceFactors[month]);
          }
        }
        
        if (customVolumes.length > 0) {
          lastVolume = customVolumes[Math.min(phaseDaysToUse, customVolumes.length) - 1];
        }
        break;
    }
    
    currentDay += phaseDaysToUse;
  }
  
  return dailyPriceFactors ? { volumes, priceFactors: dailyPriceFactors } : { volumes };
}

// Define preset volume profiles
const volumePresets = {
  baseCase: {
    name: 'Base Case',
    description: 'Initial volume: $10M, decaying to $1M over 14 days, then stable',
    generator: (days) => ({
      volumes: generateBaseVolumeProfile(days, 10000000, 1000000, 14)
    })
  },
  bullCase: {
    name: 'Bull Case',
    description: 'Initial volume: $10M, dip to $5M, then growth to $20M over 30 days',
    generator: (days) => ({
      volumes: generateBullVolumeProfile(days, 10000000, 5000000, 20000000, 7, 30)
    })
  },
  bearCase: {
    name: 'Bear Case',
    description: 'Initial volume: $5M, rapidly dropping to $500K, with continuing price decline',
    generator: (days) => {
      const result = generateBearVolumeProfile(days, 5000000, 500000, 7);
      return {
        volumes: result.volumes,
        priceFactors: result.priceFactors
      };
    }
  },
  volatileBullCase: {
    name: 'Volatile Bull Case',
    description: 'Initial dip, followed by growth with increased volatility',
    generator: (days) => ({
      volumes: generateCustomVolumeProfile(days, {
        initialVolume: 10000000,
        phases: [
          { type: 'decay', days: 7, targetVolume: 3000000 },
          { type: 'growth', days: 21, targetVolume: 25000000 },
          { type: 'decay', days: 10, targetVolume: 15000000 },
          { type: 'growth', days: 21, targetVolume: 35000000 },
          { type: 'stable', days: days - 59, volume: 35000000 }
        ]
      }).volumes
    })
  },
  sustainedGrowthCase: {
    name: 'Sustained Growth',
    description: 'Steady, continuous growth over entire period',
    generator: (days) => ({
      volumes: generateCustomVolumeProfile(days, {
        initialVolume: 8000000,
        phases: [
          { type: 'growth', days: days, targetVolume: 40000000 }
        ]
      }).volumes
    })
  }
};

export default {
  generateBaseVolumeProfile,
  generateBullVolumeProfile,
  generateBearVolumeProfile,
  generateCustomVolumeProfile,
  volumePresets
};