require("dotenv").config();

import { LinkedInProfileScraper } from "./index";
import * as fs from "fs";
import * as path from "path";

// Define the normalized output schema
interface NormalizedProfile {
  url: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  current_company: string | null;
  current_title: string | null;
  current_role_start_date: string | null;
  current_role_description_text: string | null;
  experience: Array<{
    title: string | null;
    company: string | null;
    start: string | null;
    end: string | null;
    description: string | null;
  }>;
  skills: string[];
  evidence_text: string;
  scrape_status: "success" | "failed";
  error_message?: string;
}

// URLs to scrape
const profileUrls: string[] = [
  "https://www.linkedin.com/in/ceressariceinfosecurtyspecialist",
  "https://www.linkedin.com/in/ACwAADKtvoMB6qUK7oEX-kzosgNwrEcO2r26Ptc",
  "https://www.linkedin.com/in/somewidget",
  "https://www.linkedin.com/in/matt-abazia-756b3681",
  "https://www.linkedin.com/in/erin-abbott-417573123",
  "https://www.linkedin.com/in/luther-luke-abernathy-76aab013",
  "https://www.linkedin.com/in/osama-abuzeineh-4386b384",
  "https://www.linkedin.com/in/steve-acker-2b5a8510",
  "https://www.linkedin.com/in/eduardoacostaclas",
  "https://www.linkedin.com/in/raquel-adame-6889975",
  "https://www.linkedin.com/in/mario-adamo-ba876b208",
  "https://www.linkedin.com/in/merchant-adams-6949a91a",
  "https://www.linkedin.com/in/barry-adams-312b0082",
  "https://www.linkedin.com/in/james-agee-jr",
  "https://www.linkedin.com/in/robert-aiken-75884350",
  "https://www.linkedin.com/in/michael-ajhar-30b0671a",
  "https://www.linkedin.com/in/nathan-akin-917821131",
  "https://www.linkedin.com/in/oluwatomiyin-akinbo-400589215",
  "https://www.linkedin.com/in/megan-alapati-6878a1203",
  "https://www.linkedin.com/in/ricardo-albaladejo-7426297",
  "https://www.linkedin.com/in/rashaun-albert-66403265",
  "https://www.linkedin.com/in/paul-albert-9248604b",
  "https://www.linkedin.com/in/tomasito-alcantar-8b426320",
  "https://www.linkedin.com/in/joshua-alers-varela-538599244",
  "https://www.linkedin.com/in/fnalexandre",
  "https://www.linkedin.com/in/brian-allen-b0b896a0",
  "https://www.linkedin.com/in/margarita-alvarez-31a9176a",
  "https://www.linkedin.com/in/alkarim-amlani-8701676",
  "https://www.linkedin.com/in/thomas-amuso-103047139",
];

// Helper function to format location as a string
function formatLocation(location: any): string | null {
  if (!location) return null;
  const parts = [location.city, location.province, location.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Helper function to generate evidence_text
function generateEvidenceText(profile: any): string {
  const parts: string[] = [];

  // Headline
  if (profile.userProfile?.title) {
    parts.push(profile.userProfile.title);
  }

  // Current role description
  if (profile.experiences?.[0]?.description) {
    parts.push(`Current role: ${profile.experiences[0].description}`);
  }

  // Recent prior roles (1-2)
  const priorRoles = profile.experiences?.slice(1, 3) || [];
  if (priorRoles.length > 0) {
    const priorRoleTexts = priorRoles
      .map((exp: any) => `${exp.title || "Role"} at ${exp.company || "Company"}`)
      .filter(Boolean);
    if (priorRoleTexts.length > 0) {
      parts.push(`Previously: ${priorRoleTexts.join("; ")}`);
    }
  }

  // Top skills
  if (profile.skills?.length > 0) {
    const topSkills = profile.skills
      .slice(0, 10)
      .map((s: any) => s.name)
      .filter(Boolean);
    if (topSkills.length > 0) {
      parts.push(`Skills: ${topSkills.join(", ")}`);
    }
  }

  return parts.join(" | ");
}

// Helper function to normalize the scraped data
function normalizeProfile(url: string, rawData: any): NormalizedProfile {
  const currentExp = rawData.experiences?.[0] || {};

  return {
    url,
    full_name: rawData.userProfile?.fullName || null,
    headline: rawData.userProfile?.title || null,
    location: formatLocation(rawData.userProfile?.location),
    current_company: currentExp.company || null,
    current_title: currentExp.title || null,
    current_role_start_date: currentExp.startDate || null,
    current_role_description_text: currentExp.description || null,
    experience: (rawData.experiences || []).map((exp: any) => ({
      title: exp.title || null,
      company: exp.company || null,
      start: exp.startDate || null,
      end: exp.endDateIsPresent ? null : exp.endDate || null,
      description: exp.description || null,
    })),
    skills: (rawData.skills || []).map((s: any) => s.name).filter(Boolean),
    evidence_text: generateEvidenceText(rawData),
    scrape_status: "success",
  };
}

// Helper function to create a failed profile entry
function createFailedProfile(url: string, error: Error): NormalizedProfile {
  return {
    url,
    full_name: null,
    headline: null,
    location: null,
    current_company: null,
    current_title: null,
    current_role_start_date: null,
    current_role_description_text: null,
    experience: [],
    skills: [],
    evidence_text: "",
    scrape_status: "failed",
    error_message: error.message,
  };
}

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main scraping function
async function scrapeProfiles(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LinkedIn Profile Batch Scraper");
  console.log(`Total profiles to scrape: ${profileUrls.length}`);
  console.log("=".repeat(60));

  const results: NormalizedProfile[] = [];
  let successCount = 0;
  let failCount = 0;

  const scraper = new LinkedInProfileScraper({
    sessionCookieValue: `${process.env.LINKEDIN_SESSION_COOKIE_VALUE}`,
    keepAlive: true, // Reuse browser for all scrapes
    timeout: 60000, // Increase timeout to 60 seconds
  });

  try {
    console.log("\n[INIT] Setting up Puppeteer browser...");
    await scraper.setup();
    console.log("[INIT] Browser ready!\n");

    for (let i = 0; i < profileUrls.length; i++) {
      const url = profileUrls[i];
      const progress = `[${i + 1}/${profileUrls.length}]`;

      console.log(`${progress} Scraping: ${url}`);

      try {
        const rawData = await scraper.run(url);
        const normalized = normalizeProfile(url, rawData);
        results.push(normalized);
        successCount++;

        console.log(`${progress} SUCCESS: ${normalized.full_name || "Unknown"}`);
        if (normalized.headline) {
          console.log(`         Headline: ${normalized.headline.substring(0, 60)}...`);
        }
      } catch (error) {
        failCount++;
        const err = error as Error;
        const failedProfile = createFailedProfile(url, err);
        results.push(failedProfile);

        if ((error as any).name === "SessionExpired") {
          console.error(`${progress} FATAL: Session expired! Please get a new li_at cookie.`);
          console.error("Saving partial results and exiting...");
          break;
        } else {
          console.error(`${progress} FAILED: ${err.message}`);
        }
      }

      // Add delay between requests to avoid rate limiting (5-10 seconds)
      if (i < profileUrls.length - 1) {
        const delay = 5000 + Math.random() * 5000; // 5-10 seconds
        console.log(`         Waiting ${(delay / 1000).toFixed(1)}s before next request...\n`);
        await sleep(delay);
      }
    }
  } finally {
    console.log("\n[CLEANUP] Closing browser...");
    await scraper.close();
  }

  // Save results to JSON file
  const outputPath = path.join(__dirname, "..", "scraped-profiles.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("SCRAPING COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total profiles: ${profileUrls.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Output saved to: ${outputPath}`);
  console.log("=".repeat(60));
}

// Run the scraper
scrapeProfiles().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
