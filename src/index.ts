import puppeteer, { Page, Browser } from 'puppeteer'
import treeKill from 'tree-kill';
import * as proxyChain from 'proxy-chain';

import blockedHostsList from './blocked-hosts';

import { getDurationInDays, formatDate, getCleanText, getLocationFromText, statusLog, getHostname } from './utils'
import { SessionExpired } from './errors';

export interface Location {
  city: string | null;
  province: string | null;
  country: string | null
}

interface RawProfile {
  fullName: string | null;
  title: string | null;
  location: string | null;
  photo: string | null;
  description: string | null;
  url: string;
}

export interface Profile {
  fullName: string | null;
  title: string | null;
  location: Location | null;
  photo: string | null;
  description: string | null;
  url: string;
}

interface RawExperience {
  title: string | null;
  company: string | null;
  employmentType: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateIsPresent: boolean;
  description: string | null;
}

export interface Experience {
  title: string | null;
  company: string | null;
  employmentType: string | null;
  location: Location | null;
  startDate: string | null;
  endDate: string | null;
  endDateIsPresent: boolean;
  durationInDays: number | null;
  description: string | null;
}

interface RawEducation {
  schoolName: string | null;
  degreeName: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface Education {
  schoolName: string | null;
  degreeName: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  durationInDays: number | null;
}

interface RawVolunteerExperience {
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateIsPresent: boolean;
  description: string | null;
}

export interface VolunteerExperience {
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateIsPresent: boolean;
  durationInDays: number | null;
  description: string | null;
}

export interface Skill {
  skillName: string | null;
  endorsementCount: number | null;
}

export interface Language {
  name: string | null;
  proficiency: string | null;
}

export interface Certification {
  name: string | null;
  authority: string | null;
  licenseNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
}

export interface Accomplishment {
  type: string; // 'honor', 'publication', 'patent', 'course', 'project', 'organization'
  title: string | null;
  description: string | null;
  date: string | null;
  issuer: string | null;
}

export interface Activity {
  type: 'post' | 'comment';
  text: string | null;
  date: string | null;
  url: string | null;
  likes: number | null;
  comments: number | null;
}

interface ScraperUserDefinedOptions {
  /**
   * The LinkedIn `li_at` session cookie value. Get this value by logging in to LinkedIn with the account you want to use for scraping.
   * Open your browser's Dev Tools and find the cookie with the name `li_at`. Use that value here.
   * 
   * This script uses a known session cookie of a successful login into LinkedIn, instead of an e-mail and password to set you logged in. 
   * I did this because LinkedIn has security measures by blocking login requests from unknown locations or requiring you to fill in Captcha's upon login.
   * So, if you run this from a server and try to login with an e-mail address and password, your login could be blocked. 
   * By using a known session, we prevent this from happening and allows you to use this scraper on any server on any location.
   * 
   * You probably need to get a new session cookie value when the scraper logs show it's not logged in anymore.
   */
  sessionCookieValue: string;
  /**
   * Set to true if you want to keep the scraper session alive. This results in faster recurring scrapes.
   * But keeps your memory usage high.
   * 
   * Default: `false`
   */
  keepAlive?: boolean;
  /**
   * Set a custom user agent if you like.
   * 
   * Default: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36`
   */
  userAgent?: string;
  /**
   * Use a custom timeout to set the maximum time you want to wait for the scraper 
   * to do his job.
   * 
   * Default: `10000` (10 seconds)
   */
  timeout?: number;
  /**
   * Start the scraper in headless mode, or not.
   * 
   * Default: `true`
   */
  headless?: boolean;
}

interface ScraperOptions {
  sessionCookieValue: string;
  keepAlive: boolean;
  userAgent: string;
  timeout: number;
  headless: boolean;
}

async function autoScroll(page: Page) {
  await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      var totalHeight = 0;
      var distance = 500;
      var timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

export class LinkedInProfileScraper {
  readonly options: ScraperOptions = {
    sessionCookieValue: '',
    keepAlive: false,
    timeout: 10000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
    headless: true
  }

  private browser: Browser | null = null;
  private proxyAuth: { username: string; password: string } | null = null;
  private anonymousProxyUrl: string | null = null;

  constructor(userDefinedOptions: ScraperUserDefinedOptions) {
    const logSection = 'constructing';
    const errorPrefix = 'Error during setup.';

    if (!userDefinedOptions.sessionCookieValue) {
      throw new Error(`${errorPrefix} Option "sessionCookieValue" is required.`);
    }
    
    if (userDefinedOptions.sessionCookieValue && typeof userDefinedOptions.sessionCookieValue !== 'string') {
      throw new Error(`${errorPrefix} Option "sessionCookieValue" needs to be a string.`);
    }
    
    if (userDefinedOptions.userAgent && typeof userDefinedOptions.userAgent !== 'string') {
      throw new Error(`${errorPrefix} Option "userAgent" needs to be a string.`);
    }

    if (userDefinedOptions.keepAlive !== undefined && typeof userDefinedOptions.keepAlive !== 'boolean') {
      throw new Error(`${errorPrefix} Option "keepAlive" needs to be a boolean.`);
    }
   
    if (userDefinedOptions.timeout !== undefined && typeof userDefinedOptions.timeout !== 'number') {
      throw new Error(`${errorPrefix} Option "timeout" needs to be a number.`);
    }
    
    if (userDefinedOptions.headless !== undefined && typeof userDefinedOptions.headless !== 'boolean') {
      throw new Error(`${errorPrefix} Option "headless" needs to be a boolean.`);
    }

    this.options = Object.assign(this.options, userDefinedOptions);

    statusLog(logSection, `Using options: ${JSON.stringify(this.options)}`);
  }

  /**
   * Method to load Puppeteer in memory so we can re-use the browser instance.
   */
  public setup = async () => {
    const logSection = 'setup'

    try {
      statusLog(logSection, `Launching puppeteer in the ${this.options.headless ? 'background' : 'foreground'}...`)

      // Handle proxy from environment if available using proxy-chain for authentication
      const upstreamProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
      let proxyArg: string | null = null;

      if (upstreamProxy) {
        try {
          // Create an anonymous local proxy that handles authentication
          this.anonymousProxyUrl = await proxyChain.anonymizeProxy(upstreamProxy);
          proxyArg = `--proxy-server=${this.anonymousProxyUrl}`;
          statusLog('setup', `Using proxy via proxy-chain: ${this.anonymousProxyUrl}`);
        } catch (e) {
          statusLog('setup', `Failed to set up proxy: ${e}`);
        }
      }

      this.browser = await puppeteer.launch({
        headless: this.options.headless ? 'new' : false,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          ...(this.options.headless ? [] : ['--start-maximized']),
          ...(proxyArg ? [proxyArg, '--ignore-certificate-errors', '--ignore-certificate-errors-spki-list'] : []),
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-features=site-per-process',
          '--enable-features=NetworkService',
          '--allow-running-insecure-content',
          '--enable-automation',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-web-security',
          '--autoplay-policy=user-gesture-required',
          '--disable-background-networking',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-extensions',
          '--disable-features=AudioServiceOutOfProcess',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-notifications',
          '--disable-offer-store-unmasked-wallet-cards',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-speech-api',
          '--disable-sync',
          '--disk-cache-size=33554432',
          '--hide-scrollbars',
          '--ignore-gpu-blacklist',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-pings',
          '--no-zygote',
          '--password-store=basic',
          '--use-gl=swiftshader',
          '--use-mock-keychain'
        ],
        timeout: this.options.timeout
      })

      statusLog(logSection, 'Puppeteer launched!')

      // Skip login check for enterprise cookies - we'll find out if auth works when scraping
      // await this.checkIfLoggedIn();

      statusLog(logSection, 'Done!')
    } catch (err) {
      // Kill Puppeteer
      await this.close();

      statusLog(logSection, 'An error occurred during setup.')

      throw err
    }
  };

  /**
   * Create a Puppeteer page with some extra settings to speed up the crawling process.
   */
  private createPage = async (): Promise<Page> => {
    const logSection = 'setup page'

    if (!this.browser) {
      throw new Error('Browser not set.');
    }

    // Important: Do not block "stylesheet", makes the crawler not work for LinkedIn
    const blockedResources = ['image', 'media', 'font', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'];

    try {
      const page = await this.browser.newPage()

      // Use already open page
      // This makes sure we don't have an extra open tab consuming memory
      const firstPage = (await this.browser.pages())[0];
      await firstPage.close();

      // Method to create a faster Page
      // From: https://github.com/shirshak55/scrapper-tools/blob/master/src/fastPage/index.ts#L113
      const session = await page.target().createCDPSession()
      await page.setBypassCSP(true)
      await session.send('Page.enable');
      await session.send('Page.setWebLifecycleState', {
        state: 'active',
      });

      statusLog(logSection, `Blocking the following resources: ${blockedResources.join(', ')}`)

      // A list of hostnames that are trackers
      // By blocking those requests we can speed up the crawling
      // This is kinda what a normal adblocker does, but really simple
      const blockedHosts = this.getBlockedHosts();
      const blockedResourcesByHost = ['script', 'xhr', 'fetch', 'document']

      statusLog(logSection, `Should block scripts from ${Object.keys(blockedHosts).length} unwanted hosts to speed up the crawling.`);

      // Block loading of resources, like images and css, we dont need that
      await page.setRequestInterception(true);

      page.on('request', (req) => {
        if (blockedResources.includes(req.resourceType())) {
          return req.abort()
        }

        const hostname = getHostname(req.url());

        // Block all script requests from certain host names
        if (blockedResourcesByHost.includes(req.resourceType()) && hostname && blockedHosts[hostname] === true) {
          statusLog('blocked script', `${req.resourceType()}: ${hostname}: ${req.url()}`);
          return req.abort();
        }

        return req.continue()
      })

      await page.setUserAgent(this.options.userAgent)

      await page.setViewport({
        width: 1200,
        height: 720
      })

      statusLog(logSection, `Setting session cookie using cookie: ${process.env.LINKEDIN_SESSION_COOKIE_VALUE}`)

      await page.setCookie({
        'name': 'li_at',
        'value': this.options.sessionCookieValue,
        'domain': '.www.linkedin.com'
      })

      statusLog(logSection, 'Session cookie set!')

      statusLog(logSection, 'Done!')

      return page;
    } catch (err) {
      // Kill Puppeteer
      await this.close();

      statusLog(logSection, 'An error occurred during page setup.')
      statusLog(logSection, err.message)

      throw err
    }
  };

  /**
   * Method to block know hosts that have some kind of tracking.
   * By blocking those hosts we speed up the crawling.
   * 
   * More info: http://winhelp2002.mvps.org/hosts.htm
   */
  private getBlockedHosts = (): object => {
    const blockedHostsArray = blockedHostsList.split('\n');

    let blockedHostsObject = blockedHostsArray.reduce((prev, curr) => {
      const frags = curr.split(' ');

      if (frags.length > 1 && frags[0] === '0.0.0.0') {
        prev[frags[1].trim()] = true;
      }

      return prev;
    }, {});

    blockedHostsObject = {
      ...blockedHostsObject,
      'static.chartbeat.com': true,
      'scdn.cxense.com': true,
      'api.cxense.com': true,
      'www.googletagmanager.com': true,
      'connect.facebook.net': true,
      'platform.twitter.com': true,
      'tags.tiqcdn.com': true,
      'dev.visualwebsiteoptimizer.com': true,
      'smartlock.google.com': true,
      'cdn.embedly.com': true
    }

    return blockedHostsObject;
  }

  /**
   * Method to complete kill any Puppeteer process still active.
   * Freeing up memory.
   */
  public close = (page?: Page): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const loggerPrefix = 'close';

      if (page) {
        try {
          statusLog(loggerPrefix, 'Closing page...');
          await page.close();
          statusLog(loggerPrefix, 'Closed page!');
        } catch (err) {
          reject(err)
        }
      }

      if (this.browser) {
        try {
          statusLog(loggerPrefix, 'Closing browser...');
          await this.browser.close();
          statusLog(loggerPrefix, 'Closed browser!');

          const browserProcessPid = this.browser.process()?.pid;

          // Completely kill the browser process to prevent zombie processes
          // https://docs.browserless.io/blog/2019/03/13/more-observations.html#tip-2-when-you-re-done-kill-it-with-fire
          if (browserProcessPid) {
            statusLog(loggerPrefix, `Killing browser process pid: ${browserProcessPid}...`);

            treeKill(browserProcessPid, 'SIGKILL', (err) => {
              if (err) {
                return reject(`Failed to kill browser process pid: ${browserProcessPid}`);
              }

              statusLog(loggerPrefix, `Killed browser pid: ${browserProcessPid} Closed browser.`);
              resolve()
            });
          }
        } catch (err) {
          reject(err);
        }
      }

      // Clean up the anonymous proxy if it was created
      if (this.anonymousProxyUrl) {
        try {
          await proxyChain.closeAnonymizedProxy(this.anonymousProxyUrl, true);
          statusLog(loggerPrefix, 'Closed anonymous proxy');
          this.anonymousProxyUrl = null;
        } catch (proxyErr) {
          statusLog(loggerPrefix, `Failed to close anonymous proxy: ${proxyErr}`);
        }
      }

      return resolve()
    })

  }

  /**
   * Simple method to check if the session is still active.
   */
  public checkIfLoggedIn = async () => {
    const logSection = 'checkIfLoggedIn';

    const page = await this.createPage();

    statusLog(logSection, 'Checking if we are still logged in...')

    // Try to access the feed page - if we can access it without redirect to login, we're authenticated
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'networkidle2' as const,
      timeout: this.options.timeout
    })

    const url = page.url()
    statusLog(logSection, `Final URL after feed page: ${url}`)

    // Check if we're logged in - if we're NOT redirected to login/authwall, we're logged in
    const isLoggedIn = !url.includes('/login') && !url.includes('/authwall') && !url.includes('/checkpoint') && !url.includes('/uas/')

    await page.close();

    if (isLoggedIn) {
      statusLog(logSection, 'All good. We are still logged in.')
    } else {
      const errorMessage = 'Bad news, we are not logged in! Your session seems to be expired. Use your browser to login again with your LinkedIn credentials and extract the "li_at" cookie value for the "sessionCookieValue" option.';
      statusLog(logSection, errorMessage)
      throw new SessionExpired(errorMessage)
    }
  };

  /**
   * Method to scrape a user profile.
   */
  public run = async (profileUrl: string) => {
    const logSection = 'run'

    const scraperSessionId = new Date().getTime();

    if (!this.browser) {
      throw new Error('Browser is not set. Please run the setup method first.')
    }

    if (!profileUrl) {
      throw new Error('No profileUrl given.')
    }

    if (!profileUrl.includes('linkedin.com/')) {
      throw new Error('The given URL to scrape is not a linkedin.com url.')
    }

    try {
      // Eeach run has it's own page
      const page = await this.createPage();

      statusLog(logSection, `Navigating to LinkedIn profile: ${profileUrl}`, scraperSessionId)

      await page.goto(profileUrl, {
        // Use "domcontentloaded" for faster initial load - autoScroll will load more data
        waitUntil: 'domcontentloaded' as const,
        timeout: this.options.timeout
      });

      statusLog(logSection, 'LinkedIn profile page loaded!', scraperSessionId)

      // Wait for initial content to render (LinkedIn uses heavy JS rendering)
      await new Promise(resolve => setTimeout(resolve, 2000));

      statusLog(logSection, 'Getting all the LinkedIn profile data by scrolling the page to the bottom, so all the data gets loaded into the page...', scraperSessionId)

      await autoScroll(page);

      // Wait for lazy-loaded content to appear after scrolling
      await new Promise(resolve => setTimeout(resolve, 1000));

      statusLog(logSection, 'Parsing data...', scraperSessionId)

      // Only click the expanding buttons when they exist
      // Modern LinkedIn selectors (2024-2025) + legacy fallbacks
      const expandButtonsSelectors = [
        // Modern "See more" buttons
        'button.inline-show-more-text__button',
        '.inline-show-more-text__button',
        '[aria-label*="Show more"]',
        '[aria-label*="see more"]',
        // Section-specific expand buttons
        '#about ~ div button.inline-show-more-text__button',
        '#experience ~ div button.inline-show-more-text__button',
        // Legacy selectors
        '.pv-profile-section.pv-about-section .lt-line-clamp__more',
        '#experience-section .pv-profile-section__see-more-inline.link',
        '.pv-profile-section.education-section button.pv-profile-section__see-more-inline',
        '.pv-skill-categories-section [data-control-name="skill_details"]',
      ];

      const seeMoreButtonsSelectors = [
        'button.inline-show-more-text__button',
        '.inline-show-more-text__button--pedantic',
        '.pv-entity__description .lt-line-clamp__line.lt-line-clamp__line--last .lt-line-clamp__more[href="#"]',
        '.lt-line-clamp__more[href="#"]:not(.lt-line-clamp__ellipsis--dummy)'
      ]

      statusLog(logSection, 'Expanding all sections by clicking their "See more" buttons', scraperSessionId)

      for (const buttonSelector of expandButtonsSelectors) {
        try {
          if (await page.$(buttonSelector) !== null) {
            statusLog(logSection, `Clicking button ${buttonSelector}`, scraperSessionId)
            await page.click(buttonSelector);
          }
        } catch (err) {
          statusLog(logSection, `Could not find or click expand button selector "${buttonSelector}". So we skip that one.`, scraperSessionId)
        }
      }
      

      // To give a little room to let data appear. Setting this to 0 might result in "Node is detached from document" errors
      await new Promise(resolve => setTimeout(resolve, 100));

      statusLog(logSection, 'Expanding all descriptions by clicking their "See more" buttons', scraperSessionId)

      for (const seeMoreButtonSelector of seeMoreButtonsSelectors) {
        const buttons = await page.$$(seeMoreButtonSelector)

        for (const button of buttons) {
          if (button) {
            try {
              statusLog(logSection, `Clicking button ${seeMoreButtonSelector}`, scraperSessionId)
              await button.click()
            } catch (err) {
              statusLog(logSection, `Could not find or click see more button selector "${button}". So we skip that one.`, scraperSessionId)
            }
          }
        }
      }

      statusLog(logSection, 'Parsing profile data...', scraperSessionId)

      const rawUserProfileData: RawProfile = await page.evaluate(() => {
        const url = window.location.href

        // Modern LinkedIn selectors (2024-2025)
        // Try multiple selectors for each field as LinkedIn frequently changes their DOM

        // Full name - usually in h1 on profile pages
        const fullNameElement = document.querySelector('h1.text-heading-xlarge') ||
          document.querySelector('h1[class*="text-heading"]') ||
          document.querySelector('.pv-text-details__left-panel h1') ||
          document.querySelector('main h1') ||
          document.querySelector('.pv-top-card h1') ||
          document.querySelector('.pv-top-card--list li:first-child')
        const fullName = fullNameElement?.textContent?.trim() || null

        // Title/headline - usually in a div below the name
        const titleElement = document.querySelector('.text-body-medium.break-words') ||
          document.querySelector('div[class*="text-body-medium"]') ||
          document.querySelector('.pv-text-details__left-panel .text-body-medium') ||
          document.querySelector('main section:first-child div[class*="text-body-medium"]') ||
          document.querySelector('.pv-top-card h2') ||
          document.querySelector('.top-card-layout__headline')
        const title = titleElement?.textContent?.trim() || null

        // Location - typically near the profile header
        const locationElement = document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
          document.querySelector('span[class*="text-body-small"][class*="t-black--light"]') ||
          document.querySelector('.pv-text-details__left-panel span.text-body-small') ||
          document.querySelector('.pv-top-card--list.pv-top-card--list-bullet.mt1 li:first-child') ||
          document.querySelector('.top-card-layout__first-subline')
        const location = locationElement?.textContent?.trim() || null

        // Photo
        const photoElement = document.querySelector('.pv-top-card-profile-picture__image') ||
          document.querySelector('img[class*="pv-top-card-profile-picture"]') ||
          document.querySelector('.profile-photo-edit__preview') ||
          document.querySelector('.pv-top-card__photo') ||
          document.querySelector('main img[class*="profile"]')
        const photo = photoElement?.getAttribute('src') || null

        // About/description section
        const descriptionElement = document.querySelector('#about ~ div .inline-show-more-text') ||
          document.querySelector('section[id*="about"] .inline-show-more-text') ||
          document.querySelector('.pv-shared-text-with-see-more span[aria-hidden="true"]') ||
          document.querySelector('.pv-about__summary-text .lt-line-clamp__raw-line') ||
          document.querySelector('.pv-about-section .pv-about__summary-text')
        const description = descriptionElement?.textContent?.trim() || null

        return {
          fullName,
          title,
          location,
          photo,
          description,
          url
        } as RawProfile
      })

      // Convert the raw data to clean data using our utils
      // So we don't have to inject our util methods inside the browser context, which is too damn difficult using TypeScript
      const userProfile: Profile = {
        ...rawUserProfileData,
        fullName: getCleanText(rawUserProfileData.fullName),
        title: getCleanText(rawUserProfileData.title),
        location: rawUserProfileData.location ? getLocationFromText(rawUserProfileData.location) : null,
        description: getCleanText(rawUserProfileData.description),
      }

      statusLog(logSection, `Got user profile data: ${JSON.stringify(userProfile)}`, scraperSessionId)

      statusLog(logSection, `Parsing experiences data...`, scraperSessionId)

      const rawExperiencesData: RawExperience[] = await page.evaluate(() => {
        const data: RawExperience[] = []

        // Modern LinkedIn (2024-2025): #experience is an anchor div, content is in next sibling
        // Find the experience anchor and get items from the following sibling container
        const experienceAnchor = document.querySelector('#experience')

        let experienceItems: NodeListOf<Element> | Element[] = []

        if (experienceAnchor) {
          // The actual content is in a sibling container after the anchor
          // Find all li.artdeco-list__item elements that come after #experience
          // by looking at the parent section/container
          const parentSection = experienceAnchor.closest('section') || experienceAnchor.parentElement?.parentElement
          if (parentSection) {
            experienceItems = parentSection.querySelectorAll('li.artdeco-list__item')
          }

          // If not found, try getting items from next sibling
          if (experienceItems.length === 0) {
            let sibling = experienceAnchor.nextElementSibling
            while (sibling) {
              const items = sibling.querySelectorAll('li.artdeco-list__item')
              if (items.length > 0) {
                experienceItems = items
                break
              }
              sibling = sibling.nextElementSibling
            }
          }
        }

        // Fallback: try legacy selectors
        if (experienceItems.length === 0) {
          const legacySection = document.querySelector('#experience-section')
          if (legacySection) {
            experienceItems = legacySection.querySelectorAll('ul > .ember-view')
          }
        }

        for (const item of experienceItems) {
          // Title - in the bold text with aria-hidden
          const titleElement = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]') ||
            item.querySelector('.t-bold span[aria-hidden="true"]') ||
            item.querySelector('.mr1.t-bold span') ||
            item.querySelector('h3')
          const title = titleElement?.textContent?.trim() || null

          // Company name - in t-14 t-normal span
          const companyElement = item.querySelector('span.t-14.t-normal span[aria-hidden="true"]') ||
            item.querySelector('.t-14.t-normal span[aria-hidden="true"]')
          let companyText = companyElement?.textContent?.trim() || null
          let company = companyText
          let employmentType: string | null = null

          // Clean up company name (remove "· Full-time" etc)
          if (company && company.includes('·')) {
            const parts = company.split('·')
            company = parts[0].trim()
            if (parts[1]) {
              employmentType = parts[1].trim()
            }
          }

          // Date range - in pvs-entity__caption-wrapper
          const dateElement = item.querySelector('.pvs-entity__caption-wrapper[aria-hidden="true"]') ||
            item.querySelector('span.t-14.t-normal.t-black--light span[aria-hidden="true"]')
          const dateText = dateElement?.textContent?.trim() || null

          let startDate: string | null = null
          let endDate: string | null = null
          let endDateIsPresent = false

          if (dateText) {
            // Parse date range like "Jan 2023 - Present · 3 yrs" or "Mar 2018 - Aug 2022 · 4 yrs 6 mos"
            const dateMatch = dateText.match(/([A-Za-z]+\s*\d{4})\s*[-–]\s*(Present|[A-Za-z]+\s*\d{4})/i)
            if (dateMatch) {
              startDate = dateMatch[1]?.trim() || null
              const endPart = dateMatch[2]?.trim()
              endDateIsPresent = endPart?.toLowerCase() === 'present'
              endDate = endDateIsPresent ? 'Present' : endPart || null
            }
          }

          // Location - separate span with t-black--light
          const allLightSpans = item.querySelectorAll('span.t-14.t-normal.t-black--light span[aria-hidden="true"]')
          let location: string | null = null
          for (const span of allLightSpans) {
            const text = span.textContent?.trim() || ''
            // Location typically contains city/state/country names, not dates
            if (text && !text.match(/^\d/) && !text.match(/Present|yrs?|mos?/i) && !text.match(/[A-Za-z]+\s+\d{4}/)) {
              location = text
              break
            }
          }

          // Description - if present
          const descriptionElement = item.querySelector('.inline-show-more-text span[aria-hidden="true"]') ||
            item.querySelector('.inline-show-more-text')
          const description = descriptionElement?.textContent?.trim() || null

          // Only add if we have at least a title or company
          if (title || company) {
            data.push({
              title,
              company,
              employmentType,
              location,
              startDate,
              endDate,
              endDateIsPresent,
              description
            })
          }
        }

        return data
      });

      // Convert the raw data to clean data using our utils
      // So we don't have to inject our util methods inside the browser context, which is too damn difficult using TypeScript
      const experiences: Experience[] = rawExperiencesData.map((rawExperience) => {
        const startDate = formatDate(rawExperience.startDate);
        const endDate = formatDate(rawExperience.endDate) || null;
        const endDateIsPresent = rawExperience.endDateIsPresent;

        const durationInDaysWithEndDate = (startDate && endDate && !endDateIsPresent) ? getDurationInDays(startDate, endDate) : null
        const durationInDaysForPresentDate = (endDateIsPresent && startDate) ? getDurationInDays(startDate, new Date()) : null
        const durationInDays = endDateIsPresent ? durationInDaysForPresentDate : durationInDaysWithEndDate;

        return {
          ...rawExperience,
          title: getCleanText(rawExperience.title),
          company: getCleanText(rawExperience.company),
          employmentType: getCleanText(rawExperience.employmentType),
          location: rawExperience?.location ? getLocationFromText(rawExperience.location) : null,
          startDate,
          endDate,
          endDateIsPresent,
          durationInDays,
          description: getCleanText(rawExperience.description)
        }
      })

      statusLog(logSection, `Got experiences data: ${JSON.stringify(experiences)}`, scraperSessionId)

      statusLog(logSection, `Parsing education data...`, scraperSessionId)

      const rawEducationData: RawEducation[] = await page.evaluate(() => {
        const data: RawEducation[] = []

        // Modern LinkedIn (2024-2025): #education is an anchor div
        const educationAnchor = document.querySelector('#education')

        let educationItems: NodeListOf<Element> | Element[] = []

        if (educationAnchor) {
          const parentSection = educationAnchor.closest('section') || educationAnchor.parentElement?.parentElement
          if (parentSection) {
            educationItems = parentSection.querySelectorAll('li.artdeco-list__item')
          }

          if (educationItems.length === 0) {
            let sibling = educationAnchor.nextElementSibling
            while (sibling) {
              const items = sibling.querySelectorAll('li.artdeco-list__item')
              if (items.length > 0) {
                educationItems = items
                break
              }
              sibling = sibling.nextElementSibling
            }
          }
        }

        // Fallback: legacy selectors
        if (educationItems.length === 0) {
          const legacySection = document.querySelector('#education-section')
          if (legacySection) {
            educationItems = legacySection.querySelectorAll('ul > .ember-view')
          }
        }

        for (const item of educationItems) {
          // School name - in the bold text
          const schoolNameElement = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]') ||
            item.querySelector('.t-bold span[aria-hidden="true"]')
          const schoolName = schoolNameElement?.textContent?.trim() || null

          // Degree and field of study - in t-14 t-normal span
          const degreeElement = item.querySelector('span.t-14.t-normal span[aria-hidden="true"]')
          const degreeText = degreeElement?.textContent?.trim() || null

          let degreeName: string | null = null
          let fieldOfStudy: string | null = null

          if (degreeText) {
            if (degreeText.includes(',')) {
              const parts = degreeText.split(',')
              degreeName = parts[0]?.trim() || null
              fieldOfStudy = parts.slice(1).join(',').trim() || null
            } else {
              degreeName = degreeText
            }
          }

          // Date range - in pvs-entity__caption-wrapper
          const dateElement = item.querySelector('.pvs-entity__caption-wrapper[aria-hidden="true"]') ||
            item.querySelector('span.t-14.t-normal.t-black--light span[aria-hidden="true"]')
          const dateText = dateElement?.textContent?.trim() || null

          let startDate: string | null = null
          let endDate: string | null = null

          if (dateText) {
            const dateMatch = dateText.match(/(\d{4})\s*[-–]\s*(\d{4})/)
            if (dateMatch) {
              startDate = dateMatch[1]?.trim() || null
              endDate = dateMatch[2]?.trim() || null
            }
          }

          if (schoolName) {
            data.push({
              schoolName,
              degreeName,
              fieldOfStudy,
              startDate,
              endDate
            })
          }
        }

        return data
      });

      // Convert the raw data to clean data using our utils
      // So we don't have to inject our util methods inside the browser context, which is too damn difficult using TypeScript
      const education: Education[] = rawEducationData.map(rawEducation => {
        const startDate = formatDate(rawEducation.startDate)
        const endDate = formatDate(rawEducation.endDate)

        return {
          ...rawEducation,
          schoolName: getCleanText(rawEducation.schoolName),
          degreeName: getCleanText(rawEducation.degreeName),
          fieldOfStudy: getCleanText(rawEducation.fieldOfStudy),
          startDate,
          endDate,
          durationInDays: getDurationInDays(startDate, endDate),
        }
      })

      statusLog(logSection, `Got education data: ${JSON.stringify(education)}`, scraperSessionId)

      statusLog(logSection, `Parsing volunteer experience data...`, scraperSessionId)

      const rawVolunteerExperiences: RawVolunteerExperience[] = await page.$$eval('.pv-profile-section.volunteering-section ul > li.ember-view', (nodes) => {
        // Note: the $$eval context is the browser context.
        // So custom methods you define in this file are not available within this $$eval.
        let data: RawVolunteerExperience[] = []
        for (const node of nodes) {

          const titleElement = node.querySelector('.pv-entity__summary-info h3');
          const title = titleElement?.textContent || null;
          
          const companyElement = node.querySelector('.pv-entity__summary-info span.pv-entity__secondary-title');
          const company = companyElement?.textContent || null;

          const dateRangeElement = node.querySelector('.pv-entity__date-range span:nth-child(2)');
          const dateRangeText = dateRangeElement?.textContent || null
          const startDatePart = dateRangeText?.split('–')[0] || null;
          const startDate = startDatePart?.trim() || null;

          const endDatePart = dateRangeText?.split('–')[1] || null;
          const endDateIsPresent = endDatePart?.trim().toLowerCase() === 'present' || false;
          const endDate = (endDatePart && !endDateIsPresent) ? endDatePart.trim() : 'Present';

          const descriptionElement = node.querySelector('.pv-entity__description')
          const description = descriptionElement?.textContent || null;

          data.push({
            title,
            company,
            startDate,
            endDate,
            endDateIsPresent,
            description
          })
        }

        return data
      });

      // Convert the raw data to clean data using our utils
      // So we don't have to inject our util methods inside the browser context, which is too damn difficult using TypeScript
      const volunteerExperiences: VolunteerExperience[] = rawVolunteerExperiences.map(rawVolunteerExperience => {
        const startDate = formatDate(rawVolunteerExperience.startDate)
        const endDate = formatDate(rawVolunteerExperience.endDate)

        return {
          ...rawVolunteerExperience,
          title: getCleanText(rawVolunteerExperience.title),
          company: getCleanText(rawVolunteerExperience.company),
          description: getCleanText(rawVolunteerExperience.description),
          startDate,
          endDate,
          durationInDays: getDurationInDays(startDate, endDate),
        }
      })

      statusLog(logSection, `Got volunteer experience data: ${JSON.stringify(volunteerExperiences)}`, scraperSessionId)

      statusLog(logSection, `Parsing skills data...`, scraperSessionId)

      const skills: Skill[] = await page.evaluate(() => {
        const data: Skill[] = []

        // Modern LinkedIn (2024-2025): #skills is an anchor div
        const skillsAnchor = document.querySelector('#skills')

        let skillItems: NodeListOf<Element> | Element[] = []

        if (skillsAnchor) {
          const parentSection = skillsAnchor.closest('section') || skillsAnchor.parentElement?.parentElement
          if (parentSection) {
            skillItems = parentSection.querySelectorAll('li.artdeco-list__item')
          }

          if (skillItems.length === 0) {
            let sibling = skillsAnchor.nextElementSibling
            while (sibling) {
              const items = sibling.querySelectorAll('li.artdeco-list__item')
              if (items.length > 0) {
                skillItems = items
                break
              }
              sibling = sibling.nextElementSibling
            }
          }
        }

        // Fallback: legacy selectors
        if (skillItems.length === 0) {
          const legacySection = document.querySelector('.pv-skill-categories-section')
          if (legacySection) {
            skillItems = legacySection.querySelectorAll('ol > .ember-view')
          }
        }

        for (const item of skillItems) {
          // Skill name - in the bold text
          const skillNameElement = item.querySelector('.mr1.hoverable-link-text.t-bold span[aria-hidden="true"]') ||
            item.querySelector('.t-bold span[aria-hidden="true"]')
          const skillName = skillNameElement?.textContent?.trim() || null

          // Endorsement count - if visible
          let endorsementCount = 0
          const endorsementElement = item.querySelector('.t-14.t-black--light span[aria-hidden="true"]')
          if (endorsementElement) {
            const countMatch = endorsementElement.textContent?.match(/\d+/)
            if (countMatch) {
              endorsementCount = parseInt(countMatch[0])
            }
          }

          if (skillName) {
            data.push({
              skillName,
              endorsementCount
            })
          }
        }

        return data
      }) as Skill[];

      statusLog(logSection, `Got skills data: ${JSON.stringify(skills)}`, scraperSessionId)

      statusLog(logSection, `Parsing languages data...`, scraperSessionId)

      const languages: Language[] = await page.evaluate(() => {
        const data: Language[] = []

        // Find the languages section
        const languagesAnchor = document.querySelector('#languages')

        let languageItems: NodeListOf<Element> | Element[] = []

        if (languagesAnchor) {
          const parentSection = languagesAnchor.closest('section') || languagesAnchor.parentElement?.parentElement
          if (parentSection) {
            languageItems = parentSection.querySelectorAll('li.artdeco-list__item')
          }
        }

        for (const item of languageItems) {
          const nameElement = item.querySelector('.t-bold span[aria-hidden="true"]')
          const name = nameElement?.textContent?.trim() || null

          const proficiencyElement = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')
          const proficiency = proficiencyElement?.textContent?.trim() || null

          if (name) {
            data.push({ name, proficiency })
          }
        }

        return data
      }) as Language[];

      statusLog(logSection, `Got languages data: ${JSON.stringify(languages)}`, scraperSessionId)

      statusLog(logSection, `Parsing certifications data...`, scraperSessionId)

      const certifications: Certification[] = await page.evaluate(() => {
        const data: Certification[] = []

        // Find the certifications/licenses section
        const certAnchor = document.querySelector('#licenses_and_certifications') ||
          document.querySelector('#certifications')

        let certItems: NodeListOf<Element> | Element[] = []

        if (certAnchor) {
          const parentSection = certAnchor.closest('section') || certAnchor.parentElement?.parentElement
          if (parentSection) {
            certItems = parentSection.querySelectorAll('li.artdeco-list__item')
          }
        }

        for (const item of certItems) {
          const nameElement = item.querySelector('.t-bold span[aria-hidden="true"]')
          const name = nameElement?.textContent?.trim() || null

          const authorityElement = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')
          const authority = authorityElement?.textContent?.trim() || null

          const dateElement = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')
          const dateText = dateElement?.textContent?.trim() || null

          // Parse dates like "Issued May 2023" or "Issued May 2023 · Expires May 2026"
          let startDate: string | null = null
          let endDate: string | null = null

          if (dateText) {
            const issuedMatch = dateText.match(/Issued\s+([A-Za-z]+\s+\d{4})/i)
            if (issuedMatch) startDate = issuedMatch[1]

            const expiresMatch = dateText.match(/Expires\s+([A-Za-z]+\s+\d{4})/i)
            if (expiresMatch) endDate = expiresMatch[1]
          }

          // Try to get credential URL
          const linkElement = item.querySelector('a[href*="credential"]')
          const url = linkElement?.getAttribute('href') || null

          if (name) {
            data.push({
              name,
              authority,
              licenseNumber: null,
              startDate,
              endDate,
              url
            })
          }
        }

        return data
      }) as Certification[];

      statusLog(logSection, `Got certifications data: ${JSON.stringify(certifications)}`, scraperSessionId)

      statusLog(logSection, `Parsing accomplishments data...`, scraperSessionId)

      const accomplishments: Accomplishment[] = await page.evaluate(() => {
        const data: Accomplishment[] = []

        // Map of section IDs to accomplishment types
        const sectionTypes: { [key: string]: string } = {
          'honors_and_awards': 'honor',
          'honors': 'honor',
          'publications': 'publication',
          'patents': 'patent',
          'courses': 'course',
          'projects': 'project',
          'organizations': 'organization'
        }

        for (const [sectionId, type] of Object.entries(sectionTypes)) {
          const anchor = document.querySelector(`#${sectionId}`)

          if (anchor) {
            const parentSection = anchor.closest('section') || anchor.parentElement?.parentElement
            if (parentSection) {
              const items = parentSection.querySelectorAll('li.artdeco-list__item')

              for (const item of items) {
                const titleElement = item.querySelector('.t-bold span[aria-hidden="true"]')
                const title = titleElement?.textContent?.trim() || null

                const issuerElement = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')
                const issuer = issuerElement?.textContent?.trim() || null

                const dateElement = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')
                const date = dateElement?.textContent?.trim() || null

                const descElement = item.querySelector('.inline-show-more-text span[aria-hidden="true"]')
                const description = descElement?.textContent?.trim() || null

                if (title) {
                  data.push({ type, title, description, date, issuer })
                }
              }
            }
          }
        }

        return data
      }) as Accomplishment[];

      statusLog(logSection, `Got accomplishments data: ${JSON.stringify(accomplishments)}`, scraperSessionId)

      // Scrape recent activity (posts and comments)
      statusLog(logSection, `Scraping recent activity...`, scraperSessionId)

      let activities: Activity[] = []

      try {
        // Navigate to the activity page
        const profileUsername = profileUrl.split('/in/')[1]?.replace(/\/$/, '')
        if (profileUsername) {
          const activityUrl = `https://www.linkedin.com/in/${profileUsername}/recent-activity/all/`

          await page.goto(activityUrl, {
            waitUntil: 'domcontentloaded' as const,
            timeout: this.options.timeout
          });

          // Wait for content to load
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Scroll to load more activity
          await page.evaluate(() => window.scrollBy(0, 1000));
          await new Promise(resolve => setTimeout(resolve, 1000));

          activities = await page.evaluate(() => {
            const data: Activity[] = []

            // Find activity feed items
            const feedItems = document.querySelectorAll('.feed-shared-update-v2') ||
              document.querySelectorAll('[data-urn*="activity"]') ||
              document.querySelectorAll('.occludable-update')

            let postCount = 0
            let commentCount = 0

            for (const item of feedItems) {
              if (postCount >= 3 && commentCount >= 3) break

              // Determine if it's a post or comment
              const isComment = item.querySelector('.feed-shared-update-v2__commentary') !== null ||
                item.textContent?.includes('commented on')

              const type = isComment ? 'comment' : 'post'

              if ((type === 'post' && postCount >= 3) || (type === 'comment' && commentCount >= 3)) {
                continue
              }

              // Get the text content
              const textElement = item.querySelector('.feed-shared-text span[dir="ltr"]') ||
                item.querySelector('.feed-shared-update-v2__description span') ||
                item.querySelector('.break-words span[aria-hidden="true"]')
              const text = textElement?.textContent?.trim() || null

              // Get date
              const dateElement = item.querySelector('.feed-shared-actor__sub-description span[aria-hidden="true"]') ||
                item.querySelector('time')
              const date = dateElement?.textContent?.trim() || null

              // Get engagement metrics
              const likesElement = item.querySelector('.social-details-social-counts__reactions-count')
              const likes = likesElement ? parseInt(likesElement.textContent?.trim() || '0') : null

              const commentsElement = item.querySelector('.social-details-social-counts__comments')
              const comments = commentsElement ? parseInt(commentsElement.textContent?.match(/\d+/)?.[0] || '0') : null

              // Get URL
              const urlElement = item.querySelector('a[href*="/feed/update/"]')
              const url = urlElement?.getAttribute('href') || null

              if (text) {
                data.push({ type: type as 'post' | 'comment', text, date, url, likes, comments })
                if (type === 'post') postCount++
                else commentCount++
              }
            }

            return data
          }) as Activity[];
        }
      } catch (activityError) {
        statusLog(logSection, `Could not scrape activity: ${activityError}`, scraperSessionId)
      }

      statusLog(logSection, `Got activity data: ${JSON.stringify(activities)}`, scraperSessionId)

      statusLog(logSection, `Done! Returned profile details for: ${profileUrl}`, scraperSessionId)

      if (!this.options.keepAlive) {
        statusLog(logSection, 'Not keeping the session alive.')

        await this.close(page)

        statusLog(logSection, 'Done. Puppeteer is closed.')
      } else {
        statusLog(logSection, 'Done. Puppeteer is being kept alive in memory.')

        // Only close the current page, we do not need it anymore
        await page.close()
      }

      return {
        userProfile,
        experiences,
        education,
        volunteerExperiences,
        skills,
        languages,
        certifications,
        accomplishments,
        activities
      }
    } catch (err) {
      // Kill Puppeteer
      await this.close()

      statusLog(logSection, 'An error occurred during a run.')

      // Throw the error up, allowing the user to handle this error himself.
      throw err;
    }
  }
}
