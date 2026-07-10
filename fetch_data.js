const fs = require('fs');

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

  const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}&perPage=5000`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const root = await response.json();
    const ascents = (root.data && root.data.ascents) || [];
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

    ascents.forEach(ascent => {
      if (!ascent.date || !ascent.route) return;
      
      const ascentDateObj = new Date(ascent.date);
      const ascentYear = ascentDateObj.getFullYear();
      
      // Track the absolute most recent ascent logged
      if (!mostRecentAscentDate || ascentDateObj > mostRecentAscentDate) {
        mostRecentAscentDate = ascentDateObj;
      }
      
      // Vertical calculation
      let heightValue = 0;
      if (ascent.route.height && Array.isArray(ascent.route.height)) {
        heightValue = parseFloat(ascent.route.height[0]);
      }
      if (isNaN(heightValue)) heightValue = 0;

      allTimeMeters += heightValue;
      allTimeRoutes++;

      if (ascentYear === currentYear) {
        currentYearMeters += heightValue;
        currentYearRoutes++;
      }

      // Track favorite crags & styles
      const cragName = ascent.route.ancestors && ascent.route.ancestors.parent ? ascent.route.ancestors.parent.name : 'Unknown Crag';
      if (cragName) cragCounts[cragName] = (cragCounts[cragName] || 0) + 1;
      
      const discipline = ascent.climbedGearStyle || ascent.cprStyle || 'Unknown';
      disciplineCounts[discipline] = (disciplineCounts[discipline] || 0) + 1;

      // Track unique countries
      if (ascent.route.ancestors && ascent.route.ancestors.country) {
        uniqueCountries.add(ascent.route.ancestors.country);
      } else if (ascent.route.urlAncestorStub && ascent.route.urlAncestorStub.startsWith('australia')) {
        uniqueCountries.add('Australia');
      }

      // Extract tick styles
      const tickStyle = (ascent.tick && ascent.tick.label || '').toLowerCase();
      const validStyles = ['onsight', 'flash', 'redpoint', 'pinkpoint'];
      
      const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade 
        ? parseFloat(ascent.cpr.base.internalGrade) 
        : 0;

      if (validStyles.includes(tickStyle) && internalSortGrade > hardestScore) {
        hardestScore = internalSortGrade;
        hardestName = ascent.route.name;
        hardestGrade = ascent.route.grade || 'N/A';
      }

      if (validStyles.includes(tickStyle)) {
        // Compute precise style tie-breaker weight
        let styleTier = 1;
        if (tickStyle === 'flash') styleTier = 2;
        if (tickStyle === 'onsight') styleTier = 3;

        // Clean custom Month-YY date formatter (e.g. "Jul 26")
        const formattedDate = ascentDateObj.toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit'
        }).replace(',', '');

        qualifyingSends.push({
          routeName: ascent.route.name || 'Unknown Route',
          cragName: cragName,
          gradeDisplay: ascent.route.grade || 'N/A',
          gradeWeight: internalSortGrade,
          styleWeight: styleTier,
          style: ascent.tick.name || ascent.tick.label,
          date: formattedDate
        });
      }
    });

    // Sort primarily by numerical difficulty, tie-breaking via cleaner style profile
    qualifyingSends.sort((a, b) => {
      if (b.gradeWeight !== a.gradeWeight) {
        return b.gradeWeight - a.gradeWeight;
      }
      return b.styleWeight - a.styleWeight;
    });
    
    const topTenSends = qualifyingSends.slice(0, 10);

    // Calculate dynamic dashboard state elements
    let daysSinceLastClimb = '—';
    let moodText = 'Unknown 🤷‍♂️';

    if (mostRecentAscentDate) {
      const now = new Date();
      const diffTime = Math.abs(now - mostRecentAscentDate);
      daysSinceLastClimb = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (daysSinceLastClimb < 3) {
        moodText = "Ecstatic! 🧗‍♂️🔥";
      } else if (daysSinceLastClimb < 7) {
        moodText = "Okay 🫡";
      } else if (daysSinceLastClimb < 30) {
        moodText = "Itching to get back on the wall 🦎🧗";
      } else {
        moodText = "Must be dead 💀⚰️";
      }
    }

    // Compute top crag playground
    let favCrag = 'None Logged';
    let maxCragCount = 0;
    for (const crag in cragCounts) {
      if (cragCounts[crag] > maxCragCount) {
        maxCragCount = cragCounts[crag];
        favCrag = crag;
      }
    }

    // Compute top discipline
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
    console.log("Analytics modifications written successfully.");

  } catch (error) {
    console.error("Error executing layout calculation updates:", error);
    process.exit(1);
  }
}

main();
