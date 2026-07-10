const fs = require('fs');

async function main() {
  const username = process.env.THECRAG_USERNAME;
  const apiKey = process.env.THECRAG_API_KEY;
  
  if (!username || !apiKey) {
    console.error("Missing credentials.");
    process.exit(1);
  }

  const url = `https://www.thecrag.com/api/logbook/ascents?user=${username}&key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const root = await response.json();
    
    // Dive into the top-level 'data' wrapper we just discovered
    const payloadData = root.data || [];
    
    console.log("--- NESTED DATA STRUCTURE START ---");
    console.log("Type of payloadData:", typeof payloadData, "IsArray:", Array.isArray(payloadData));
    
    // If it's an array of ascents directly:
    if (Array.isArray(payloadData) && payloadData.length > 0) {
      console.log("Sample ascent item structure:", JSON.stringify(payloadData[0], null, 2));
    } 
    // If it's an object containing an inner array:
    else if (typeof payloadData === 'object') {
      console.log("Keys inside data:", Object.keys(payloadData));
      for (const key in payloadData) {
        if (Array.isArray(payloadData[key]) && payloadData[key].length > 0) {
          console.log(`Found inner array '${key}'. Sample item:`, JSON.stringify(payloadData[key][0], null, 2));
        }
      }
    }
    console.log("--- NESTED DATA STRUCTURE END ---");

    // Standard safety fallback artifact
    const resultPayload = {
      lastUpdated: new Date().toISOString(),
      year: new Date().getFullYear(),
      totalMeters: 0,
      totalClimbs: 0
    };

    fs.writeFileSync('dashboard_data.json', JSON.stringify(resultPayload, null, 2));

  } catch (error) {
    console.error("Failed executing nested extraction:", error);
    process.exit(1);
  }
}

main();
