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
  summary: string | null;
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
    location: string | null;
    employment_type: string | null;
  }>;
  education: Array<{
    school: string | null;
    degree: string | null;
    field_of_study: string | null;
    start: string | null;
    end: string | null;
  }>;
  volunteer_experience: Array<{
    title: string | null;
    organization: string | null;
    start: string | null;
    end: string | null;
    description: string | null;
  }>;
  skills: string[];
  languages: Array<{
    name: string | null;
    proficiency: string | null;
  }>;
  certifications: Array<{
    name: string | null;
    authority: string | null;
    issue_date: string | null;
    expiration_date: string | null;
    url: string | null;
  }>;
  accomplishments: Array<{
    type: string;
    title: string | null;
    description: string | null;
    date: string | null;
    issuer: string | null;
  }>;
  recent_posts: Array<{
    text: string | null;
    date: string | null;
    likes: number | null;
    comments: number | null;
    url: string | null;
  }>;
  recent_comments: Array<{
    text: string | null;
    date: string | null;
    url: string | null;
  }>;
  evidence_text: string;
  scrape_status: "success" | "failed";
  error_message?: string;
}

// URLs to scrape
const profileUrls: string[] = [
  "https://www.linkedin.com/in/jeffrey-bartsch-b482a5b6",
  "https://www.linkedin.com/in/alfred-boateng-7360741b8",
  "https://www.linkedin.com/in/ACwAABF35jABbxriFlPzSE8TcrzG8UKXcX_rEFc",
  "https://www.linkedin.com/in/ccollins231",
  "https://www.linkedin.com/in/maryann-collins-592a3831",
  "https://www.linkedin.com/in/justin-collins-2b73836b",
  "https://www.linkedin.com/in/richard-conner-ab3b9322",
  "https://www.linkedin.com/in/carol-conner-9b00954",
  "https://www.linkedin.com/in/dave-crawford-756a27b",
  "https://www.linkedin.com/in/kingsley-ero",
  "https://www.linkedin.com/in/dusty-galbraith-a1332b125",
  "https://www.linkedin.com/in/david-dusty-galbraith-6b523b61",
  "https://www.linkedin.com/in/charles-gateley-8a2482105",
  "https://www.linkedin.com/in/bruce-gilbert-ab185314",
  "https://www.linkedin.com/in/rebecca-gunning-76620510",
  "https://www.linkedin.com/in/james-kosior-7aa5039b",
  "https://www.linkedin.com/in/craig-lindahl-52165a9",
  "https://www.linkedin.com/in/angelica-madrid-198245278",
  "https://www.linkedin.com/in/jeff-m-menard-mba",
  "https://www.linkedin.com/in/robert-nicholson-4960139",
  "https://www.linkedin.com/in/ACwAAAKnm_oBu2Kes4LJFQRwG2592i7Iv-Dni9M",
  "https://www.linkedin.com/in/jeffrey-schaf-967a9374",
  "https://www.linkedin.com/in/tiffany-shamaly-5a219758",
  "https://www.linkedin.com/in/maureen-shamaly",
  "https://www.linkedin.com/in/tara-stephenson-39912555",
  "https://www.linkedin.com/in/brian-wilson-1868b69",
  "https://www.linkedin.com/in/delda-wilson-34409778",
  "https://www.linkedin.com/in/gerald-wilson-2a8216bb",
  "https://www.linkedin.com/in/rodney-wilson-89536510",
  "https://www.linkedin.com/in/tanner-wilson-170216113",
  "https://www.linkedin.com/in/millie-wilson-5970a863",
  "https://www.linkedin.com/in/david-winkelman-7519882",
  "https://www.linkedin.com/in/robert-w-38b40941",
  "https://www.linkedin.com/in/rickie-worrell-83163716",
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
      .map((s: any) => s.skillName || s.name)
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

  // Separate posts and comments from activities
  const posts = (rawData.activities || []).filter((a: any) => a.type === 'post').slice(0, 3);
  const comments = (rawData.activities || []).filter((a: any) => a.type === 'comment').slice(0, 3);

  return {
    url,
    full_name: rawData.userProfile?.fullName || null,
    headline: rawData.userProfile?.title || null,
    location: formatLocation(rawData.userProfile?.location),
    summary: rawData.userProfile?.description || null,
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
      location: formatLocation(exp.location),
      employment_type: exp.employmentType || null,
    })),
    education: (rawData.education || []).map((edu: any) => ({
      school: edu.schoolName || null,
      degree: edu.degreeName || null,
      field_of_study: edu.fieldOfStudy || null,
      start: edu.startDate || null,
      end: edu.endDate || null,
    })),
    volunteer_experience: (rawData.volunteerExperiences || []).map((vol: any) => ({
      title: vol.title || null,
      organization: vol.company || null,
      start: vol.startDate || null,
      end: vol.endDateIsPresent ? null : vol.endDate || null,
      description: vol.description || null,
    })),
    skills: (rawData.skills || []).map((s: any) => s.skillName || s.name).filter(Boolean),
    languages: (rawData.languages || []).map((lang: any) => ({
      name: lang.name || null,
      proficiency: lang.proficiency || null,
    })),
    certifications: (rawData.certifications || []).map((cert: any) => ({
      name: cert.name || null,
      authority: cert.authority || null,
      issue_date: cert.startDate || null,
      expiration_date: cert.endDate || null,
      url: cert.url || null,
    })),
    accomplishments: (rawData.accomplishments || []).map((acc: any) => ({
      type: acc.type || 'unknown',
      title: acc.title || null,
      description: acc.description || null,
      date: acc.date || null,
      issuer: acc.issuer || null,
    })),
    recent_posts: posts.map((post: any) => ({
      text: post.text || null,
      date: post.date || null,
      likes: post.likes || null,
      comments: post.comments || null,
      url: post.url || null,
    })),
    recent_comments: comments.map((comment: any) => ({
      text: comment.text || null,
      date: comment.date || null,
      url: comment.url || null,
    })),
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
    summary: null,
    current_company: null,
    current_title: null,
    current_role_start_date: null,
    current_role_description_text: null,
    experience: [],
    education: [],
    volunteer_experience: [],
    skills: [],
    languages: [],
    certifications: [],
    accomplishments: [],
    recent_posts: [],
    recent_comments: [],
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

  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    const progress = `[${i + 1}/${profileUrls.length}]`;

    console.log(`${progress} Scraping: ${url}`);

    // Create fresh scraper for each profile (more resilient)
    const scraper = new LinkedInProfileScraper({
      sessionCookieValue: `${process.env.LINKEDIN_SESSION_COOKIE_VALUE}`,
      keepAlive: false,
      timeout: 90000, // 90 second timeout
    });

    try {
      await scraper.setup();
      const rawData = await scraper.run(url);
      await scraper.close();

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

      // Make sure to close the scraper on error
      try { await scraper.close(); } catch (e) {}

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
