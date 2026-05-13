import { isValidRepository, normalizeRepository } from '../../../src/lib/githubIssue.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const repository = normalizeRepository(String(req.body?.repository || ''));
    const issues = Array.isArray(req.body?.issues) ? req.body.issues : [];

    if (!isValidRepository(repository)) throw httpError(400, 'Enter a valid GitHub repository in owner/repository format.');
    if (issues.length === 0) throw httpError(400, 'No issues were selected for GitHub logging.');
    if (issues.length > 100) throw httpError(400, 'Please log 100 issues or fewer at one time.');

    const token = String(req.body?.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
    if (!token) throw httpError(401, 'GitHub authentication is not configured. Paste a GitHub token in the dashboard field or set GITHUB_TOKEN/GH_TOKEN in Vercel environment variables, then try again.');

    const created = [];
    for (const issue of issues) {
      const title = String(issue.title || '').trim();
      const body = String(issue.body || '').trim();
      if (!title || !body) continue;
      created.push(await createGitHubIssue(repository, { title, body }, token));
    }

    res.status(200).json({ repository, createdCount: created.length, issues: created });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || 'GitHub issue logging failed' });
  }
}

async function createGitHubIssue(repository: string, issue: { title: string; body: string }, token: string) {
  const [owner, repo] = repository.split('/');
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  const basePayload = {
    title: issue.title,
    body: issue.body,
    labels: [],
    type: 'Bug',
  };

  let response = await postGitHubIssue(endpoint, token, basePayload);
  if (!response.ok && response.status === 422) {
    response = await postGitHubIssue(endpoint, token, { title: issue.title, body: issue.body, labels: [] });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message ? `GitHub rejected the issue: ${data.message}` : `GitHub issue creation failed with HTTP ${response.status}`;
    throw httpError(response.status, message);
  }

  return {
    number: data.number,
    title: data.title,
    url: data.html_url,
  };
}

function postGitHubIssue(endpoint: string, token: string, payload: Record<string, unknown>) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DesignQA-AI',
    },
    body: JSON.stringify(payload),
  });
}

function httpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}
