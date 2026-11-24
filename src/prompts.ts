import { previousPeriod, shiftDate } from './analysis.js';

interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  render(args: Record<string, string>, now: Date): string;
}

// Search Console data usually arrives with a delay of about two to three days.
const DATA_LAG_DAYS = 3;

const SITE_ARGUMENT: PromptArgument = {
  name: 'siteUrl',
  description: 'Search Console property, such as sc-domain:example.com',
  required: true,
};

function reportingRange(now: Date, days: number) {
  const endDate = shiftDate(now.toISOString().slice(0, 10), -DATA_LAG_DAYS);
  const startDate = shiftDate(endDate, -(days - 1));
  return { startDate, endDate, previous: previousPeriod(startDate, endDate) };
}

function parseDays(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('days must be an integer from 1 to 90');
  }
  return days;
}

const REPORT_RULES = `Rules:
- Use only numbers that the tools return. Do not estimate missing values.
- Say when a result is limited by anonymized queries, maxRows, or incomplete data.
- Treat likelyCause values as hypotheses and name the evidence for each one.
- Do not call a write tool.`;

export const PROMPTS: PromptDefinition[] = [
  {
    name: 'weekly_seo_report',
    title: 'Weekly SEO report',
    description: 'Build a weekly Search Console report with changes, risks, and prioritized actions',
    arguments: [
      SITE_ARGUMENT,
      { name: 'brandTerms', description: 'Comma-separated brand terms', required: false },
    ],
    render: (args, now) => {
      const range = reportingRange(now, 7);
      const brandTerms = (args.brandTerms ?? '')
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      const brandStep = brandTerms.length
        ? `5. Call brand_split with brandTerms ${JSON.stringify(brandTerms)}.`
        : '5. Skip brand_split because no brand terms were given.';
      return `Create a weekly SEO report for ${args.siteUrl}.

Current period: ${range.startDate} to ${range.endDate}.
Previous period: ${range.previous.startDate} to ${range.previous.endDate}.

Steps:
1. Call compare_periods with dimension "page".
2. Call compare_periods with dimension "query".
3. Call detect_traffic_drops.
4. Call find_ctr_opportunities and detect_quick_wins.
${brandStep}
6. Call find_cannibalization.

Report format:
- Summary: clicks, impressions, CTR, and position with their changes.
- Winners and losers: the pages and queries that moved the most.
- Risks: traffic drops and their evidence.
- Top 5 actions: order by estimated click impact and name the page or query.

${REPORT_RULES}`;
    },
  },
  {
    name: 'diagnose_traffic_drop',
    title: 'Diagnose a traffic drop',
    description: 'Find which pages lost traffic and test the likely causes',
    arguments: [
      SITE_ARGUMENT,
      { name: 'days', description: 'Days in each comparison period. Default: 28', required: false },
    ],
    render: (args, now) => {
      const range = reportingRange(now, parseDays(args.days, 28));
      return `Diagnose the traffic change for ${args.siteUrl}.

Current period: ${range.startDate} to ${range.endDate}.
Previous period: ${range.previous.startDate} to ${range.previous.endDate}.

Steps:
1. Call compare_periods with dimensions "page", "query", "country", and "device" to find where the change is concentrated.
2. Call detect_traffic_drops.
3. Call detect_content_decay with endDate ${range.endDate} to separate gradual decline from a sudden drop.
4. Call batch_url_inspect for up to 20 of the pages that lost the most clicks.
5. Call list_sitemaps to check sitemap errors.

Report the most likely causes in order, the evidence for each one, what you could not verify, and the next action.

${REPORT_RULES}`;
    },
  },
  {
    name: 'indexing_audit',
    title: 'Indexing audit',
    description: 'Audit the index status of important URLs and sitemaps',
    arguments: [
      SITE_ARGUMENT,
      { name: 'urls', description: 'Comma-separated URLs. Default: top pages by clicks', required: false },
    ],
    render: (args, now) => {
      const range = reportingRange(now, 28);
      const urls = (args.urls ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      const urlStep = urls.length
        ? `2. Call batch_url_inspect with inspectionUrls ${JSON.stringify(urls.slice(0, 100))}.`
        : `2. Call search_analytics with dimensions "page", startDate ${range.startDate}, endDate ${range.endDate}, and rowLimit 50. Then call batch_url_inspect with those pages.`;
      return `Audit indexing for ${args.siteUrl}.

Steps:
1. Call list_sitemaps and report sitemap errors and warnings.
${urlStep}
3. Group the results by verdict and coverageState.
4. Report canonical mismatches, robots.txt blocks, and fetch failures.

Give each issue an affected URL count, an example URL, and a fix. Google allows 2,000 inspections per site per day, so do not repeat a URL.

${REPORT_RULES}`;
    },
  },
];

export function renderPrompt(
  name: string,
  args: Record<string, string> = {},
  now: Date = new Date(),
) {
  const prompt = PROMPTS.find((candidate) => candidate.name === name);
  if (!prompt) throw new Error(`Unknown prompt: ${name}`);
  for (const argument of prompt.arguments) {
    if (argument.required && !args[argument.name]?.trim()) {
      throw new Error(`Missing required argument: ${argument.name}`);
    }
  }
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.render(args, now) },
      },
    ],
  };
}
