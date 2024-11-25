import fs from "fs/promises";
import path from "path";
import puppeteer, { Browser, Page } from "puppeteer";

type ScrapingResult = {
    totalCreators: number;
    timestamp: Date;
};

type Creator = {
    name: string;
    url: string;
};

type CreatorDetails = Creator & {
    minutesPurchased?: number;
    pricePerMinute?: number;
    marketCap?: number;
};

type FormattedCreatorDetails = {
    category: string;
    creators: CreatorDetails[];
};

async function initializeBrowser(): Promise<Browser> {
    const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(50000);
    return browser;
}

async function saveCreatorsByCategory({
    categoryName,
    directoryName,
    creators,
}: {
    categoryName: string;
    directoryName: string;
    creators: Creator[];
}): Promise<void> {
    const dataDir: string = path.join(process.cwd(), directoryName);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
        path.join(
            dataDir,
            `${categoryName.toLowerCase().replace(/\s+/g, "-")}.json`
        ),
        JSON.stringify(creators, null, 2)
    );
}

async function scrapeCreatorCount(page: Page): Promise<number> {
    let categories = [
        {
            name: "Founders",
            category: 1,
        },
        {
            name: "Influencers",
            category: 2,
        },
        {
            name: "Personalities",
            category: 3,
        },
        {
            name: "Investors",
            category: 4,
        },
        {
            name: "Developers",
            category: 5,
        },
        {
            name: "Time.fun Team",
            category: 8,
        },
        {
            name: "Data Analysis",
            category: 9,
        },
        {
            name: "Trading Analysis",
            category: 10,
        },
    ];

    let totalCreators = 0;

    for (const category of categories) {
        await page.goto(
            `https://time.fun/categories?category=${category.category}`,
            {
                waitUntil: "networkidle0",
                timeout: 50000,
            }
        );

        const creatorsGridElement = await page.waitForSelector(".grid");
        const creators: Creator[] =
            (await creatorsGridElement?.evaluate((el) => {
                const links = el.querySelectorAll("a");
                return Array.from(links).map((link) => ({
                    name:
                        link.querySelector("h3")?.textContent?.trim() ||
                        "Unknown Creator",
                    url: link.href,
                }));
            })) || [];

        console.log(`Found ${creators.length} creators in ${category.name}`);
        await saveCreatorsByCategory({
            categoryName: category.name,
            directoryName: `creators`,
            creators,
        });
        totalCreators += creators.length;
    }

    return totalCreators;
}

async function readCreatorFiles(): Promise<Map<string, Creator[]>> {
    const dataDir = path.join(process.cwd(), "creators");
    const files = await fs.readdir(dataDir);
    const creatorMap = new Map<string, Creator[]>();

    for (const file of files) {
        if (file.endsWith(".json")) {
            const category = file.replace(".json", "");
            const content = await fs.readFile(
                path.join(dataDir, file),
                "utf-8"
            );
            creatorMap.set(category, JSON.parse(content));
        }
    }

    return creatorMap;
}

async function scrapeCreatorDetails(
    page: Page,
    creator: Creator
): Promise<CreatorDetails> {
    await page.goto(creator.url, { waitUntil: "networkidle0", timeout: 50000 });

    const details = await page.evaluate(() => {
        const minutesElement = document.evaluate(
            "//text()[contains(., 'Minutes purchased')]",
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue?.parentElement;

        const minutesText =
            minutesElement?.nextElementSibling?.querySelector("p")?.textContent;

        const priceElement = document.evaluate(
            "//text()[contains(., 'Price per minute')]",
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue?.parentElement;

        const priceText =
            priceElement?.nextElementSibling?.querySelector("p")?.textContent;

        const marketCapElement = document.evaluate(
            "//text()[contains(., 'Market Cap')]",
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue?.parentElement;

        let marketCapText =
            marketCapElement?.nextElementSibling?.querySelector(
                "p"
            )?.textContent;

        marketCapText = marketCapText?.replace("$", "").replace(",", "");

        return {
            minutesPurchased: minutesElement
                ? parseInt(minutesText || "0", 10)
                : 0,
            pricePerMinute: priceElement
                ? parseFloat(priceText?.replace("$", "") || "0")
                : 0,
            marketCap: marketCapElement ? parseFloat(marketCapText || "0") : 0,
        };
    });

    console.log("details", details);

    return {
        ...creator,
        ...details,
    };
}

async function scrapeAllCreatorDetails(): Promise<void> {
    let browser: Browser | null = null;

    try {
        const creatorMap = await readCreatorFiles();
        browser = await initializeBrowser();
        const page = await browser.newPage();

        for (const [category, creators] of creatorMap) {
            console.log(
                `Processing ${creators.length} creators from ${category}`
            );
            const detailedCreators: CreatorDetails[] = [];

            for (const creator of creators) {
                try {
                    const details = await scrapeCreatorDetails(page, creator);
                    detailedCreators.push(details);
                    console.log(`Scraped details for ${creator.name}`);
                } catch (err) {
                    console.error(`Failed to scrape ${creator.name}:`, err);
                }
            }

            // Save updated data with details
            await saveCreatorsByCategory({
                categoryName: category,
                directoryName: `creators-details`,
                creators: detailedCreators,
            });
        }
    } catch (err) {
        console.error("Error during detail scraping:", err);
        throw err;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function generateReadableReport(): Promise<void> {
    try {
        const dataDir = path.join(process.cwd(), "creators-details");
        const files = await fs.readdir(dataDir);
        const allData: FormattedCreatorDetails[] = [];

        // Read and parse all JSON files
        for (const file of files) {
            if (file.endsWith(".json")) {
                const category = file.replace(".json", "").replace(/-/g, " ");
                const content = await fs.readFile(
                    path.join(dataDir, file),
                    "utf-8"
                );
                allData.push({
                    category:
                        category.charAt(0).toUpperCase() + category.slice(1),
                    creators: JSON.parse(content),
                });
            }
        }

        // Start with report header
        let reportContent = "Time.fun Creators Report\n";
        reportContent += `Generated on: ${new Date().toLocaleString()}\n\n`;

        let totalCreators = 0;
        let totalMarketCap = 0;

        // First pass to calculate totals
        for (const categoryData of allData) {
            totalCreators += categoryData.creators.length;
            categoryData.creators.forEach((creator) => {
                totalMarketCap += creator.marketCap || 0;
            });
        }

        // Add summary at the top
        reportContent += "Summary\n";
        reportContent += "=======\n";
        reportContent += `Total Creators: ${totalCreators}\n`;
        reportContent += `Total Market Cap: $${totalMarketCap.toLocaleString()}\n\n`;
        reportContent += "=".repeat(50) + "\n\n";

        // Process each category
        for (const categoryData of allData) {
            reportContent += `\n${categoryData.category}\n`;
            reportContent += "=".repeat(categoryData.category.length) + "\n\n";

            // Sort creators by market cap (descending)
            const sortedCreators = categoryData.creators.sort(
                (a, b) => (b.marketCap || 0) - (a.marketCap || 0)
            );

            for (const creator of sortedCreators) {
                totalCreators++;
                totalMarketCap += creator.marketCap || 0;

                reportContent += `Creator: ${creator.name}\n`;
                reportContent += `URL: ${creator.url}\n`;
                reportContent += `Minutes Purchased: ${
                    creator.minutesPurchased?.toLocaleString() || "N/A"
                }\n`;
                reportContent += `Price per Minute: $${
                    creator.pricePerMinute?.toFixed(2) || "N/A"
                }\n`;
                reportContent += `Market Cap: $${
                    creator.marketCap?.toLocaleString() || "N/A"
                }\n`;
                reportContent += "-".repeat(50) + "\n";
            }
        }

        // Add summary at the end
        reportContent += "\nSummary\n";
        reportContent += "=======\n";
        reportContent += `Total Creators: ${totalCreators}\n`;
        reportContent += `Total Market Cap: $${totalMarketCap.toLocaleString()}\n`;

        // Save the report
        await fs.writeFile(
            path.join(process.cwd(), "creator-report.txt"),
            reportContent
        );

        console.log("Report generated successfully: creator-report.txt");
    } catch (err) {
        console.error("Error generating report:", err);
        throw err;
    }
}

async function main(): Promise<ScrapingResult> {
    let browser: Browser | null = null;
    try {
        browser = await initializeBrowser();
        const page = await browser.newPage();

        const totalCreators = await scrapeCreatorCount(page);
        await scrapeAllCreatorDetails();
        await generateReadableReport();

        return {
            totalCreators,
            timestamp: new Date(),
        };
    } catch (err) {
        console.error("Error during scraping:", err);
        throw err;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main()
    .then((result) => {
        console.log("Scraping Result:", result);
    })
    .catch((err) => {
        console.error("Scraping failed:", err);
        process.exit(1);
    });
