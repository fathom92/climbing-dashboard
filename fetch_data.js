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

  console.log("Starting multi-page API harvest...");

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
  let allTimeRoutes = 0;
  let currentYearMeters = 0;
  let currentYearRoutes = 0;
  
  let qualifyingSends = [];
  const cragCounts = {};
  const disciplineCounts = {};
  const uniqueCountries = new Set();
  
  let hardestScore = 0;
  let hardestName = 'None';
  let hardestGrade = 'N/A';
  let mostRecentAscentDate = null;

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

    // EFFORT RECOVERY: Sum vertical meters and total counts across ALL logs (including failed attempts)
    allTimeMeters += heightValue;
    allTimeRoutes++;

    if (ascentYear === currentYear) {
      currentYearMeters += heightValue;
      currentYearRoutes++;
    }

    const cragLocationName = extractCragName(ascent.route.urlAncestorStub);
    const wallName = ascent.route.ancestors && ascent.route.ancestors.parent ? ascent.route.ancestors.parent.name : '';
    const combinedLocation = wallName && wallName !== cragLocationName ? `${wallName}, ${cragLocationName}` : cragLocationName;

    if (cragLocationName) {
      cragCounts[cragLocationName] = (cragCounts[cragLocationName] || 0) + 1;
    }
    
    const discipline = ascent.climbedGearStyle || ascent.cprStyle || 'Unknown';
    disciplineCounts[discipline] = (disciplineCounts[discipline] || 0) + 1;

    if (ascent.route.ancestors && ascent.route.ancestors.country) {
      uniqueCountries.add(ascent.route.ancestors.country);
    } else if (ascent.route.urlAncestorStub && ascent.route.urlAncestorStub.startsWith('australia')) {
      uniqueCountries.add('Australia');
    }
    
    const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade 
      ? parseFloat(ascent.cpr.base.internalGrade) 
      : 0;

    if (successfulStyles.includes(tickStyle) && internalSortGrade > hardestScore) {
      hardestScore = internalSortGrade;
      hardestName = ascent.route.name;
      hardestGrade = ascent.route.grade || 'N/A';
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

  let favDiscipline = 'None Logged';
  let maxDiscCount = 0;
  for (const disc in disciplineCounts) {
    if (disciplineCounts[disc] > maxDiscCount) {
      maxDiscCount = disciplineCounts[disc];
      favDiscipline = disc;
    }
  }

  const countryCount = uniqueCountries.size === 0 ? 1 : uniqueCountries.size;

  const resultPayload = {
    lastUpdated: new Date().toISOString(),
    currentYear: currentYear,
    daysSinceLastClimb: daysSinceLastClimb,
    mood: moodText,
    capabilities: {
      onsight: peakCapability.onsight.label,
      flash: peakCapability.flash.label,
      redpoint: peakCapability.redpoint.label
    },
    metrics: {
      allTimeMeters: Math.round(allTimeMeters),
      allTimeRoutes: allTimeRoutes,
      yearMeters: Math.round(currentYearMeters),
      yearRoutes: currentYearRoutes
    },
    topTen: topTenSends,
    funStats: {
      favoriteCrag: favCrag,
      favoriteCragCount: maxCragCount,
      preferredStyle: favDiscipline.charAt(0).toUpperCase() + favDiscipline.slice(1),
      hardestSend: `${hardestName} (Grade ${hardestGrade})`,
      countriesCount: countryCount
    }
  };

  fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
  console.log("Global volume calculations optimized.");
}

main();
