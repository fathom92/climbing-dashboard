const fs = require('fs');

function extractCragName(urlStub) {
  if (!urlStub) return 'Unknown Crag';
  const parts = urlStub.split('/');
  if (parts.length === 0) return 'Unknown Crag';
  const rawStub = parts[parts.length - 1];
  return rawStub.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

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

  const currentYear = new Date().getFullYear();
  let allTimeMeters = 0;
  let allTimeLogs = 0;
  let allTimeSuccesses = 0;
  let currentYearMeters = 0;
  let currentYearLogs = 0;
  let currentYearSuccesses = 0;
  
  let qualifyingSends = [];
  const cragCounts = {};
  const uniqueCountries = new Set();
  
  let hardestSendWeight = 0;
  let hardestSendNum = 0;
  let mostRecentAscentDate = null;

  // Grade 23 calculation buckets
  let grade23TotalAttempts = 0;
  let grade23CleanSends = 0;

  // Hardest attempt tracking variables
  let hardestAttemptWeight = 0;
  let hardestAttemptRouteName = 'None';
  let hardestAttemptCragName = 'N/A';
  let hardestAttemptGradeLabel = 'N/A';

  const peakCapability = {
    onsight: { score: 0, label: 'N/A' },
    flash: { score: 0, label: 'N/A' },
    redpoint: { score: 0, label: 'N/A' }
  };

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

    // Sum overall career efforts across all types
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

    if (ascent.route.ancestors && ascent.route.ancestors.country) {
      uniqueCountries.add(ascent.route.ancestors.country);
    } else if (ascent.route.urlAncestorStub && ascent.route.urlAncestorStub.startsWith('australia')) {
      uniqueCountries.add('Australia');
    }
    
    const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade 
      ? parseFloat(ascent.cpr.base.internalGrade) 
      : 0;
      
    const numericalGrade = ascent.route.grade ? parseInt(ascent.route.grade) : 0;

    // Track Grade 23 specific conversion stats
    if (numericalGrade === 23) {
      grade23TotalAttempts++;
      if (successfulStyles.includes(tickStyle)) {
        grade23CleanSends++;
      }
    }

    // Track hardest logged send profile
    if (successfulStyles.includes(tickStyle) && internalSortGrade > hardestSendWeight) {
      hardestSendWeight = internalSortGrade;
      hardestSendNum = numericalGrade;
    }

    // Track hardest overall attempt (any style that isn't a clean send)
    if (!successfulStyles.includes(tickStyle) && internalSortGrade > hardestAttemptWeight) {
      hardestAttemptWeight = internalSortGrade;
      hardestAttemptRouteName = ascent.route.name || 'Unknown Route';
      hardestAttemptCragName = combinedLocation;
      hardestAttemptGradeLabel = ascent.route.grade || 'N/A';
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

      const shortDate = ascentDateObj.toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit'
      }).replace(',', '');

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

  qualifyingSends.sort((a, b) => {
    if (b.gradeWeight !== a.gradeWeight) return b.gradeWeight - a.gradeWeight;
    return b.styleWeight - a.styleWeight;
  });
  
  const topTenSends = qualifyingSends.slice(0, 10);

  // Define dynamic target destination metrics based on career high numbers
  const targetProjectGrade = hardestSendNum > 0 ? hardestSendNum + 1 : 24;
  
  let daysSinceLastClimb = '—';
  let moodText = 'Unknown 🤷‍♂️';

  if (mostRecentAscentDate) {
    const now = new Date();
    const diffTime = Math.abs(now - mostRecentAscentDate);
    daysSinceLastClimb = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (daysSinceLastClimb < 3) moodText = "Ecstatic! 🧗‍♂️🔥";
    else if (daysSinceLastClimb < 7) moodText = "Okay 🫡";
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

  const allTimeSuccessRate = allTimeLogs > 0 ? Math.round((allTimeSuccesses / allTimeLogs) * 100) : 0;
  const grade23SuccessRate = grade23TotalAttempts > 0 ? Math.round((grade23CleanSends / grade23TotalAttempts) * 100) : 0;
  
  // Everest target conversion comparison calculations
  const everestHeight = 8848;
  const everestProgress = Math.min(Math.round((allTimeMeters / everestHeight) * 100), 100);

  const resultPayload = {
    lastUpdated: new Date().toISOString(),
    currentYear: currentYear,
    daysSinceLastClimb: daysSinceLastClimb,
    mood: moodText,
    targetGrade: targetProjectGrade,
    capabilities: {
      onsight: peakCapability.onsight.label,
      flash: peakCapability.flash.label,
      redpoint: peakCapability.redpoint.label
    },
    metrics: {
      allTimeMeters: Math.round(allTimeMeters),
      allTimeLogs: allTimeLogs,
      allTimeSuccessRate: allTimeSuccessRate,
      everestPercent: everestProgress,
      yearMeters: Math.round(currentYearMeters),
      yearRoutes: currentYearLogs,
      grade23Rate: grade23SuccessRate,
      grade23Sends: grade23CleanSends,
      grade23Attempts: grade23TotalAttempts
    },
    topTen: topTenSends,
    funStats: {
      favoriteCrag: favCrag,
      favoriteCragCount: maxCragCount,
      hardestAttempt: `${hardestAttemptRouteName} (Grade ${hardestAttemptGradeLabel})`,
      hardestAttemptLocation: hardestAttemptCragName,
      countriesCount: uniqueCountries.size === 0 ? 1 : uniqueCountries.size
    }
  };

  fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
  console.log("Upgraded structural telemetry assets compiled.");
}

main();
