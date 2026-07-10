const fs = require('fs');

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing environment credentials.");
    process.exit(1);
  }

  const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    
    // DIAGNOSTIC LOGS: This prints the structure of the data to your GitHub Actions tab
    console.log("--- RAW API STRUCTURE START ---");
    console.log("Keys available at the top level:", Object.keys(data));
    
    // Look for arrays inside the data
    for (const key in data) {
      if (Array.isArray(data[key])) {
        console.log(`Found an array named '${key}' with ${data[key].length} items.`);
        if (data[key].length > 0) {
          console.log("Sample item from this array:", JSON.stringify(data[key][0], null, 2));
        }
      }
    }
    console.log("--- RAW API STRUCTURE END ---");

    // Standard fallback fallback logic so the site doesn't break while debugging
    const resultPayload = {
      lastUpdated: new Date().toISOString(),
      year: new Date().getFullYear(),
      totalMeters: 0,
      totalClimbs: 0,
      debugMessage: "Checking logs for data structure..."
    };

    fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));

  } catch (error) {
    console.error("Failed executing diagnostic run:", error);
    process.exit(1);
  }
}

main();
