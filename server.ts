import express from "express";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import serverless from "serverless-http";

const PORT = 3000;

const app = express();
app.use(express.json());

const GEOAPIFY_CATEGORY_MAP: Record<string, string> = {
  dentist: "healthcare.dentist",
  restaurant: "catering.restaurant",
  lawyer: "service.financial,service.financial.lawyer,office",
  plumber: "service.maintenance.plumber",
  electrician: "service.maintenance.electrician",
  hvac: "service.maintenance.hvac",
  roofer: "service.maintenance.roofer",
  landscaping: "service.maintenance.landscaping",
  accounting: "service.financial.accountant",
  real_estate: "office.real_estate",
  gym: "sport.fitness",
  spa: "commercial.health_and_beauty.spa",
  salon: "commercial.health_and_beauty.hairdresser",
  auto_repair: "service.vehicle.repair",
};

app.post("/api/search", async (req, res) => {
  try {
    const { city, state, niche } = req.body;
    const apiKey = process.env.GEOAPIFY_API_KEY;
    
    if (!apiKey || apiKey === "YOUR_GEOAPIFY_API_KEY") {
      return res.status(500).json({ error: "Geoapify API key is missing. Please add GEOAPIFY_API_KEY to your secrets." });
    }

    const category = GEOAPIFY_CATEGORY_MAP[niche] || "commercial";

    // 1. Geocode city and state
    const geocodeRes = await axios.get(`https://api.geoapify.com/v1/geocode/search`, {
      params: {
        text: `${city}, ${state} US`,
        apiKey,
        format: "json"
      }
    });
    
    if (!geocodeRes.data.results || geocodeRes.data.results.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const primaryLocation = geocodeRes.data.results[0];
    const { place_id, lon, lat } = primaryLocation;

    // 2. Fetch Places
    let placesRes: any;
    try {
      placesRes = await axios.get(`https://api.geoapify.com/v2/places`, {
        params: {
          categories: category,
          filter: `place:${place_id}`,
          limit: 50,
          apiKey
        }
      });
      
      if (!placesRes.data.features || placesRes.data.features.length === 0) {
        // Fallback if 0 results
        placesRes = await axios.get(`https://api.geoapify.com/v2/places`, {
          params: {
            categories: category,
            filter: `circle:${lon},${lat},15000`,
            limit: 50,
            apiKey
          }
        });
      }
    } catch (e: any) {
      // Fallback if place filter throws 400/500
      placesRes = await axios.get(`https://api.geoapify.com/v2/places`, {
        params: {
          categories: category,
          filter: `circle:${lon},${lat},15000`,
          limit: 50,
          apiKey
        }
      });
    }

    const leads = (placesRes.data.features || [])
      .map((f: any) => f.properties)
      .filter((p: any) => p.website && typeof p.website === "string" && p.website.startsWith("http"));

    const simplifiedLeads = leads.map((l: any, i: number) => ({
      id: `${l.place_id || i}`,
      name: l.name || "Unknown Business",
      website: l.website,
      address: l.formatted || `${l.city || city}, ${l.state || state}`,
    }));

    // Deduplicate by website
    const uniqueLeads = simplifiedLeads.filter((v: any, i: number, a: any) => a.findIndex((t: any) => (t.website === v.website)) === i);

    res.json({ leads: uniqueLeads });
  } catch (error: any) {
    console.error("Search error:", error?.response?.data || error.message);
    if (error?.response?.status === 401) {
      return res.status(401).json({ error: "Invalid Geoapify API key. Please check your GEOAPIFY_API_KEY secret." });
    }
    if (error?.response?.status === 400) {
      return res.status(400).json({ error: `Bad request to Geoapify. Data: ${JSON.stringify(error.response.data)}` });
    }
    res.status(500).json({ error: `Failed to search leads. Data: ${JSON.stringify(error?.response?.data || error.message)}` });
  }
});

app.post("/api/scrape-email", async (req, res) => {
  try {
    const { website } = req.body;
    if (!website) return res.status(400).json({ error: "Website required" });

    const baseUrl = new URL(website).origin;
    const pathsToScrape = [
      "",
      "/contact",
      "/contact-us",
      "/locations",
      "/location",
      "/team",
      "/about",
      "/about-us",
    ];

    const emailsFound = new Set<string>();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const scrapePromises = pathsToScrape.map(async (p) => {
      try {
        const url = `${baseUrl}${p}`;
        const response = await axios.get(url, {
          validateStatus: (status) => status < 500,
          timeout: 5000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          }
        });
        
        if (response.status < 400 && response.data && typeof response.data === 'string') {
          const text = cheerio.load(response.data).text();
          const matches = text.match(emailRegex);
          if (matches) {
            matches.forEach(m => emailsFound.add(m.trim().toLowerCase()));
          }
        }
      } catch (err) {
        // ignore individual page scrape failures
      }
    });

    await Promise.all(scrapePromises);

    const validEmails = Array.from(emailsFound).filter(e => {
        const invalidTokens = ['noreply', 'sentry', 'wix', 'godaddy', '@2x', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
        if (invalidTokens.some(token => e.includes(token))) return false;
        
        // ensure valid form
        const parts = e.split('@');
        if (parts.length !== 2) return false;
        if (parts[1].split('.').length < 2) return false;

        return true;
    });

    // Smart sort
    validEmails.sort((a, b) => {
      const aPersonal = a.includes('.') && a.indexOf('.') < a.indexOf('@') ? -2 : 0;
      const bPersonal = b.includes('.') && b.indexOf('.') < b.indexOf('@') ? -2 : 0;
      
      const genericWords = ['info', 'contact', 'hello', 'support', 'sales', 'admin'];
      const aGeneric = genericWords.some(w => a.startsWith(`${w}@`)) ? -1 : 0;
      const bGeneric = genericWords.some(w => b.startsWith(`${w}@`)) ? -1 : 0;

      const aScore = aPersonal + aGeneric;
      const bScore = bPersonal + bGeneric;
      
      return aScore - bScore;
    });

    res.json({ email: validEmails.length > 0 ? validEmails[0] : null });
  } catch (error: any) {
    console.error("Scrape error:", error.message);
    res.status(500).json({ error: "Failed to scrape email" });
  }
});

app.post("/api/audit", async (req, res) => {
  try {
    const { website } = req.body;
    if (!website) return res.status(400).json({ error: "Website required" });

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    }

    // 1. Get Screenshot from Microlink
    // Note: Microlink API without API key has rate limits but works for light usage.
    const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(website)}&screenshot=true&meta=false`;
    const mlRes = await axios.get(microlinkUrl);
    
    if (!mlRes.data?.data?.screenshot?.url) {
      return res.status(500).json({ error: "Failed to capture screenshot" });
    }
    const screenshotUrl = mlRes.data.data.screenshot.url;

    // Fetch screenshot to array buffer for Gemini
    const imageRes = await axios.get(screenshotUrl, { responseType: 'arraybuffer' });
    const imageBase64 = Buffer.from(imageRes.data, 'binary').toString('base64');

    // 2. Audit with Gemini Vision
    const ai = new GoogleGenAI({ apiKey: key });
    
    const prompt = `You are a Senior Conversion Rate Optimization (CRO) Expert & Coprywriter. 
Analyze this website screenshot.

Then output a JSON object with exactly these fields (do not wrap in markdown tags like \`\`\`json):
{
  "auditScore": 55,
  "auditDetail": "Short 2-3 sentence analysis of their hero section, value proposition, or call-to-action.",
  "coldEmail": "The hyper-personalized cold email following the 'Observation -> Insight -> Gap' framework."
}

Audit Score rules:
- 0 to 100.
- 0-50 = Major issues (e.g., poor design, no clear CTA, looks dated).
- 51-75 = Average (e.g., okay but could be clearer, basic template).
- 76-100 = Excellent.

Cold Email framework rules (The "Dirty" Rule):
- No flattery. No "I hope you're well". No "I noticed your website".
- Subject: 2-4 words, lowercase, specific (e.g., 'your hero section layout' or 'mobile menu issues').
- Body pattern: 'I was looking at your site and the [Specific Detail] is [Problem]. Usually, this makes it harder for customers to [Action]. I recorded a 2-min video on how to fix this. Worth a look?'
- Sign off: 'Animesh, ProspectPilot'

Respond ONLY with valid JSON.`;

    const chatRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            prompt,
            {
                inlineData: {
                    data: imageBase64,
                    mimeType: 'image/jpeg',
                }
            }
        ],
        config: {
          responseMimeType: "application/json"
        }
    });

    let result;
    try {
      result = JSON.parse(chatRes.text || "{}");
    } catch (e) {
      // In case it comes back wrapped in markdown
      let text = (chatRes.text || "").replace(/^```json/m, "").replace(/```$/m, "").trim();
      result = JSON.parse(text || "{}");
    }

    res.json({
        screenshotUrl,
        auditScore: result.auditScore || 50,
        auditDetail: result.auditDetail || "No audit detals returned.",
        coldEmail: result.coldEmail || "Could not generate email."
    });

  } catch (error: any) {
    console.error("Audit error:", error.message);
    res.status(500).json({ error: "Failed to audit website" });
  }
});

export const handler = serverless(app);

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static files
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  // Only run standard listener if not in serverless environment
  if (process.env.NODE_ENV !== "serverless") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();
