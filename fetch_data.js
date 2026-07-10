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
    
    // Fun stats counters
    const cragCounts = {};
    const disciplineCounts = {};
    let hardestScore = 0;
    let hardestName = 'None';
    let hardestGrade = 'N/A';

    ascents.forEach(ascent => {
      if (!ascent.date || !ascent.route) return;
      
      const ascentYear = new Date(ascent.date).getFullYear();
      
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
      const cragName = ascent.route.ancestors && ascent.route.ancestors.parent ? ascent.route.ancestors.parent.name : null;
      if (cragName) cragCounts[cragName] = (cragCounts[cragName] || 0) + 1;
      
      const discipline = ascent.climbedGearStyle || ascent.cprStyle || 'Unknown';
      disciplineCounts[discipline] = (disciplineCounts[discipline] || 0) + 1;

      // Extract tick styles
      const tickStyle = (ascent.tick && ascent.tick.label || '').toLowerCase();
      const validStyles = ['onsight', 'flash', 'redpoint', 'pinkpoint'];
      
      // Calculate internal grade score
      const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade 
        ? parseFloat(ascent.cpr.base.internalGrade) 
        : 0;

      // Track absolute hardest single route send
      if (validStyles.includes(tickStyle) && internalSortGrade > hardestScore) {
        hardestScore = internalSortGrade;
        hardestName = ascent.route.name;
        hardestGrade = ascent.route.grade || 'N/A';
      }

      if (validStyles.includes(tickStyle)) {
        // Apply priority bonuses: Onsight (30), Flash (20), Redpoint/Pinkpoint (10)
        let styleBonus = 10;
        if (tickStyle === 'onsight') styleBonus = 30;
        if (tickStyle === 'flash') styleBonus = 20;

        // Custom composite score weight
        const customRankWeight = internalSortGrade + styleBonus;

        // Extract attempts count if logged by the user, default to 1 if clean send
        const attemptsValue = ascent.attempts || (tickStyle === 'onsight' || tickStyle === 'flash' ? 1 : '—');

        qualifyingSends.push({
          routeName: ascent.route.name || 'Unknown Route',
          gradeDisplay: ascent.route.grade || 'N/A',
          sortWeight: customRankWeight,
          style: ascent.tick.name || ascent.tick.label,
          attempts: attemptsValue,
          date: ascent.date.substring(0, 10)
        });
      }
    });

    // Sort descending by style + difficulty weight
    qualifyingSends.sort((a, b) => b.sortWeight - a.sortWeight);
    const topTenSends = qualifyingSends.slice(0, 10);

    // Compute top crag
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

    const resultPayload = {
      lastUpdated: new Date().toISOString(),
      currentYear: currentYear,
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
        hardestSend: `${hardestName} (Grade ${hardestGrade})`
      }
    };

    fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
    console.log("Upgraded data configurations processed.");

  } catch (error) {
    console.error("Error calculating climbing metrics:", error);
    process.exit(1);
  }
}

main();
