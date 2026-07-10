const fs = require('fs');

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

  // Target theCrag logbook ascents endpoint using credentials
  const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    
    // Safety check for empty or malformed API arrays
    const ascents = data.ascents || [];
    const currentYear = new Date().getFullYear();
    
    let totalMetersThisYear = 0;
    let totalCountThisYear = 0;

    ascents.forEach(ascent => {
      if (!ascent.date) return;
      
      const ascentYear = new Date(ascent.date).getFullYear();
      
      if (ascentYear === currentYear) {
        // Only tally metrics if a valid height number is present
        if (ascent.height && !isNaN(ascent.height)) {
          totalMetersThisYear += parseFloat(ascent.height);
        }
        totalCountThisYear++;
      }
    });

    // Output a clean JSON data payload for the frontend website to read
    const resultPayload = {
      lastUpdated: new Date().toISOString(),
      year: currentYear,
      totalMeters: Math.round(totalMetersThisYear),
      totalClimbs: totalCountThisYear
    };

    fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));
    console.log("Successfully compiled annual metrics:", resultPayload);

  } catch (error) {
    console.error("Failed executing data sync processing:", error);
    process.exit(1);
  }
}

main();
