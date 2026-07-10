const fs = require('fs');

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

  // Requesting a high perPage ceiling to fetch your logbook history in a single request
  const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}&perPage=5000`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const root = await response.json();
    const ascents = (root.data && root.data.ascents) || [];
    const currentYear = new Date().getFullYear();
    
    // Core structural metrics buckets
    let allTimeMeters = 0;
    let allTimeRoutes = 0;
    let currentYearMeters = 0;
    let currentYearRoutes = 0;
    
    // Array to process top performances
    let qualifyingSends = [];

    ascents.forEach(ascent => {
      if (!ascent.date || !ascent.route) return;
      
      const ascentYear = new Date(ascent.date).getFullYear();
      
      // Parse individual route vertical metrics
      let heightValue = 0;
      if (ascent.route.height && Array.isArray(ascent.route.height)) {
        heightValue = parseFloat(ascent.route.height[0]);
      }
      if (isNaN(heightValue)) heightValue = 0;

      // Update baseline all-time aggregations
      allTimeMeters += heightValue;
      allTimeRoutes++;

      // Update current dynamic year variables
      if (ascentYear === currentYear) {
        currentYearMeters += heightValue;
        currentYearRoutes++;
      }

      // Filter for top 10 hardest lists (Redpoint, Flash, Onsight)
      const tickStyle = (ascent.tick && ascent.tick.label || '').toLowerCase();
      const validStyles = ['redpoint', 'flash', 'onsight'];
      
      if (validStyles.includes(tickStyle)) {
        // Extract internal comparison weights for accurate numerical sorting
        const internalSortGrade = ascent.cpr && ascent.cpr.base && ascent.cpr.base.internalGrade 
          ? parseFloat(ascent.cpr.base.internalGrade) 
          : 0;
        
        qualifyingSends.push({
          routeName: ascent.route.name || 'Unknown Route',
          gradeDisplay: ascent.route.grade || 'N/A',
          sortWeight: internalSortGrade,
          style: ascent.tick.name || ascent.tick.label,
          date: ascent.date.substring(0, 10) // Format to clean YYYY-MM-DD string
        });
      }
    });

    // Sort descending by internal score weight, then grab top 10 items
    qualifyingSends.sort((a, b) => b.sortWeight - a.sortWeight);
    const topTenSends = qualifyingSends.slice(0, 10);

    // Save consolidated structural payload for frontend use
    const resultPayload = {
      lastUpdated: new Date().toISOString(),
      currentYear: currentYear,
      metrics: {
        allTimeMeters: Math.round(allTimeMeters),
        allTimeRoutes: allTimeRoutes,
        yearMeters: Math.round(currentYearMeters),
        yearRoutes: currentYearRoutes
      },
      topTen: topTenSends
    };

    fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
    console.log("Upgraded dashboard payload compiled successfully.");

  } catch (error) {
    console.error("Error executing advanced analytics compilation:", error);
    process.exit(1);
  }
}

main();
