import axios from 'axios';

async function run() {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.log("No GEOAPIFY_API_KEY");
    return;
  }
  try {
    const res = await axios.get(`https://api.geoapify.com/v1/geocode/search?text=Los Angeles, CA US&apiKey=${apiKey}&format=json`);
    const place_id = res.data.results[0].place_id;
    console.log("Place ID:", place_id);
    const cat = "service.financial,service.financial.lawyer,office";
    const placesRes = await axios.get(`https://api.geoapify.com/v2/places?categories=${cat}&filter=place:${place_id}&limit=5&apiKey=${apiKey}`);
    console.log("Places count:", placesRes.data.features.length);
  } catch (e: any) {
    console.log("Error:", e.response?.data || e.message);
  }
}
run();
