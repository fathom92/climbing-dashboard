const fs = require('fs');

function extractCragName(urlStub) {
  if (!urlStub) return 'Unknown Crag';
  const parts = urlStub.split('/');
  if (parts.length === 0) return 'Unknown Crag';
  const rawStub = parts[parts.length - 1];
  return rawStub.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Custom calculation engine mapping dewpoints + heat to rank crisp friction conditions
function calculateFrictionRating(temp, humidity) {
  if (temp < 12 && humidity < 50) return "Crisp Overlord 🥶 (Perfect Friction)";
  if (temp <= 18 && humidity < 60) return "Prime Sending 🧗‍♂️ (Great Friction)";
  if (temp > 24 || humidity > 75) return "Greasy Slopers 🥵 (Poor Friction)";
  return "Fair 🌤️ (Standard Friction)";
}

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

  // 1. HARVEST OUTDOOR CLIMBING LOGS FROM THECRAG
  let allAscents = [];
  let currentPage = 1;
  let keepFetching = true;

  while (keepFetching) {
    const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}&perPage=100&page=${currentPage}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const root = await response.json();
      const pageAscents = (root.data && root.data.ascents) || [];
      if (pageAscents.length === 0) {
        keepFetching = false;
      } else {
        allAscents = allAscents.concat(pageAscents);
        currentPage++;
      }
    } catch (error) {
      console.error(`Error on page ${currentPage}:`, error);
      process.exit(1);
    }
  }

  allAscents.sort((a, b) => new Date(b.date) - new Date(a.date));

  const currentYear = new Date().getFullYear();
  let allTimeMeters = 0;
  let allTimeLogs = 0;
  let allTimeSuccesses = 0;
  let currentYearMeters = 0;
  let currentYearLogs = 0;
  let currentYearSuccesses = 0;
  
  let qualifyingSends = [];
  const cragCounts = {};
  let hardestSendWeight = 0;
  let hardestSendNum = 0;
  let mostRecentAscentDate = null;

  let hardestAttemptWeight = 0;
  let hardestAttemptRouteName = 'None';
  let hardestAttemptCragName = 'N/A';
  let hardestAttemptGradeLabel = 'N/A';

  const peakCapability = {
    onsight: { score: 0, label: 'N/A' },
    flash: { score: 0, label: 'N/A' },
    redpoint: { score: 0, label: 'N/A' }
  };

  const pyramidData = {};
  for (let g = 10; g <= 26; g++) {
    pyramidData[g] = { onsight: 0, flash: 0, redpoint: 0, other: 0, total: 0 };
  }

  allAscents.forEach(ascent => {
    if (!ascent.route || !ascent.tick) return;
    const tickStyle = (ascent.tick.label || '').toLowerCase();
    const successfulStyles = ['onsight', 'flash', 'redpoint', 'pinkpoint'];
    const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade ? parseFloat(ascent.cpr.base.internalGrade) : 0;
    const numericalGrade = ascent.route.grade ? parseInt(ascent.route.grade) : 0;

    if (successfulStyles.includes(tickStyle) && internalSortGrade > hardestSendWeight) {
      hardestSendWeight = internalSortGrade;
      hardestSendNum = numericalGrade;
    }
  });

  const breakthroughGrade = hardestSendNum > 0 ? hardestSendNum : 23;
  let dynamicTotalAttempts = 0;
  let dynamicCleanSends = 0;
  let auditHistoryLogPool = [];

  allAscents.forEach(ascent => {
    if (!ascent.date || !ascent.route) return;
    
    const ascentDateObj = new Date(ascent.date);
    const ascentYear = ascentDateObj.getFullYear();
    
    if (!mostRecentAscentDate || ascentDateObj > mostRecentAscentDate) {
      mostRecentAscentDate = ascentDateObj;
    }

    const tickStyle = (ascent.tick && ascent.tick.label || '').toLowerCase();
    const successfulStyles = ['onsight', 'flash', 'redpoint', 'pinkpoint'];
    
    let heightValue = 0;
    if (ascent.route.height && Array.isArray(ascent.route.height)) {
      heightValue = parseFloat(ascent.route.height[0]);
    }
    if (isNaN(heightValue)) heightValue = 0;

    allTimeMeters += heightValue;
    allTimeLogs++;

    if (ascentYear === currentYear) {
      currentYearMeters += heightValue;
      currentYearLogs++;
    }

    if (successfulStyles.includes(tickStyle)) {
      allTimeSuccesses++;
      if (ascentYear === currentYear) currentYearSuccesses++;
    }

    const cragLocationName = extractCragName(ascent.route.urlAncestorStub);
    const wallName = ascent.route.ancestors && ascent.route.ancestors.parent ? ascent.route.ancestors.parent.name : '';
    const combinedLocation = wallName && wallName !== cragLocationName ? `${wallName}, ${cragLocationName}` : cragLocationName;

    if (cragLocationName) {
      cragCounts[cragLocationName] = (cragCounts[cragLocationName] || 0) + 1;
    }
    
    const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade ? parseFloat(ascent.cpr.base.internalGrade) : 0;
    const numericalGrade = ascent.route.grade ? parseInt(ascent.route.grade) : 0;

    if (numericalGrade >= 10 && numericalGrade <= 26) {
      pyramidData[numericalGrade].total++;
      if (tickStyle === 'onsight') pyramidData[numericalGrade].onsight++;
      else if (tickStyle === 'flash') pyramidData[numericalGrade].flash++;
      else if (tickStyle === 'redpoint' || tickStyle === 'pinkpoint') pyramidData[numericalGrade].redpoint++;
      else pyramidData[numericalGrade].other++;
    }

    if (numericalGrade === breakthroughGrade) {
      dynamicTotalAttempts++;
      if (successfulStyles.includes(tickStyle)) dynamicCleanSends++;
    }

    if (!successfulStyles.includes(tickStyle) && internalSortGrade > hardestAttemptWeight) {
      hardestAttemptWeight = internalSortGrade;
      hardestAttemptRouteName = ascent.route.name || 'Unknown Route';
      hardestAttemptCragName = combinedLocation;
      hardestAttemptGradeLabel = ascent.route.grade || 'N/A';
    }

    const shortDate = ascentDateObj.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(',', '');

    if (auditHistoryLogPool.length < 50) {
      auditHistoryLogPool.push({
        routeName: ascent.route.name || 'Unknown Route',
        locationText: combinedLocation,
        gradeDisplay: ascent.route.grade || 'N/A',
        styleDisplay: ascent.tick.name || ascent.tick.label || 'Attempt',
        date: shortDate
      });
    }

    if (successfulStyles.includes(tickStyle)) {
      let styleTier = 1;
      if (tickStyle === 'flash') styleTier = 2;
      if (tickStyle === 'onsight') styleTier = 3;

      let capKey = tickStyle;
      if (tickStyle === 'pinkpoint') capKey = 'redpoint';

      if (internalSortGrade > peakCapability[capKey].score) {
        peakCapability[capKey].score = internalSortGrade;
        peakCapability[capKey].label = ascent.route.grade || 'N/A';
      }

      qualifyingSends.push({
        routeName: ascent.route.name || 'Unknown Route',
        locationText: combinedLocation,
        gradeDisplay: ascent.route.grade || 'N/A',
        gradeWeight: internalSortGrade,
        styleWeight: styleTier,
        style: ascent.tick.name || ascent.tick.label,
        date: shortDate
      });
    }
  });

  qualifyingSends.sort((a, b) => b.gradeWeight - a.gradeWeight || b.styleWeight - a.styleWeight);
  const topFiveSends = qualifyingSends.slice(0, 5);
  const targetProjectGrade = breakthroughGrade + 1;
  
  let daysSinceLastClimb = '—';
  let moodText = 'Unknown 🤷‍♂️';

  if (mostRecentAscentDate) {
    const now = new Date();
    const diffTime = Math.abs(now - mostRecentAscentDate);
    daysSinceLastClimb = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (daysSinceLastClimb < 3) moodText = "Ecstatic! 🧗‍♂️🔥";
    else if (daysSinceLastClimb < 7) moodText = "Satiated 😊🧗‍♂️"; 
    else if (daysSinceLastClimb < 30) moodText = "Itching to get back on the wall 🦎🧗";
    else moodText = "Must be dead 💀⚰️";
  }

  let favCrag = 'None Logged';
  let maxCragCount = 0;
  for (const crag in cragCounts) {
    if (cragCounts[crag] > maxCragCount) {
      maxCragCount = cragCounts[crag];
      favCrag = crag;
    }
  }

  let maxGradeVolume = 0;
  for (const g in pyramidData) {
    if (pyramidData[g].total > maxGradeVolume) maxGradeVolume = pyramidData[g].total;
  }

  const allTimeSuccessRate = allTimeLogs > 0 ? Math.round((allTimeSuccesses / allTimeLogs) * 100) : 0;
  const dynamicSuccessRate = dynamicTotalAttempts > 0 ? Math.round((dynamicCleanSends / dynamicTotalAttempts) * 100) : 0;
  
  const everestHeight = 8848;
  const currentLapNumber = Math.floor(allTimeMeters / everestHeight) + 1;
  const remainderMeters = allTimeMeters % everestHeight;
  const everestProgressPercent = Math.round((remainderMeters / everestHeight) * 100);

  // 2. HARVEST GEOGRAPHIC WEATHER PARAMETERS FOR MEDLOW BATH (-33.60, 150.29)
  let weekendForecastPayload = [];
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=-33.60&longitude=150.29&daily=temperature_2m_max,relative_humidity_2m_max&timezone=Australia%2FSydney`;
    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();
    
    if (weatherData && weatherData.daily) {
      weatherData.daily.time.forEach((timeStr, idx) => {
        const dateObj = new Date(timeStr);
        const dayNum = dateObj.getDay(); // 6 = Saturday, 0 = Sunday
        if (dayNum === 6 || dayNum === 0) {
          const maxTemp = weatherData.daily.temperature_2m_max[idx];
          const maxHumid = weatherData.daily.relative_humidity_2m_max[idx];
          const friendlyDate = dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
          
          weekendForecastPayload.push({
            dateLabel: friendlyDate,
            temp: Math.round(maxTemp),
            frictionText: calculateFrictionRating(maxTemp, maxHumid)
          });
        }
      });
    }
  } catch (err) {
    console.error("Weather loop error:", err);
  }

  const resultPayload = {
    lastUpdated: new Date().toISOString(),
    currentYear: currentYear,
    daysSinceLastClimb: daysSinceLastClimb,
    mood: moodText,
    targetGrade: targetProjectGrade,
    breakthroughGrade: breakthroughGrade,
    weekendWeather: weekendForecastPayload,
    metrics: {
      allTimeMeters: Math.round(allTimeMeters),
      allTimeLogs: allTimeLogs,
      allTimeSuccessRate: allTimeSuccessRate,
      everestLap: currentLapNumber,
      everestPercent: everestProgressPercent,
      yearMeters: Math.round(currentYearMeters),
      yearRoutes: currentYearLogs,
      dynamicRate: dynamicSuccessRate,
      dynamicSends: dynamicCleanSends,
      dynamicAttempts: dynamicTotalAttempts
    },
    topTen: topFiveSends,
    auditLog: auditHistoryLogPool, 
    pyramid: pyramidData,
    maxPyramidVolume: maxGradeVolume,
    capabilities: {
      onsight: peakCapability.onsight.label,
      flash: peakCapability.flash.label,
      redpoint: peakCapability.redpoint.label
    },
    funStats: {
      favoriteCrag: favCrag,
      favoriteCragCount: maxCragCount,
      hardestAttempt: `${hardestAttemptRouteName} (Grade ${hardestAttemptGradeLabel})`,
      hardestAttemptLocation: hardestAttemptCragName
    }
  };

  fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
  console.log("Telemetry systems update complete.");
}

main();
