import type { ComponentMatch, Issue, QAReport } from '../types';

export const DEFAULT_TEMPLATE = 'qc-bug-report.yml';

export interface GitHubIssueDraft {
  title: string;
  body: string;
  url: string;
}

export interface IssueDraftScope {
  issue?: Issue;
  issueIndex?: number;
  viewport?: string;
}

export function normalizeRepository(value: string): string {
  return value
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\/issues.*$/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

export function isValidRepository(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizeRepository(value));
}

export function buildGitHubIssueDraft(report: QAReport, match: ComponentMatch, repository: string, template = DEFAULT_TEMPLATE, scope: IssueDraftScope = {}): GitHubIssueDraft {
  const normalizedRepo = normalizeRepository(repository);
  const title = buildIssueTitle(match, scope.issue, report.pageUrl);
  const body = buildIssueBody(report, match, scope);
  const url = buildIssueUrl(normalizedRepo, template || DEFAULT_TEMPLATE, title, body, report, match, scope);

  return { title, body, url };
}

export function buildIssueTitle(match: ComponentMatch, issue = match.issues[0], pageUrl = ''): string {
  const primaryIssue = issue;
  const issueType = primaryIssue ? labelForIssue(primaryIssue) : 'Design QA mismatch';
  const property = primaryIssue?.property ? ` - ${primaryIssue.property}` : '';
  return `[${pageLabelFromUrl(pageUrl)}]: ${match.figmaNode.name} - ${issueType}${property}`;
}

function buildIssueBody(report: QAReport, match: ComponentMatch, scope: IssueDraftScope): string {
  const issue = scope.issue ?? match.issues[0];
  const qc = buildQcFields(report, match, issue, scope);

  return [
    '### Issue Type',
    qc.issueType,
    '',
    '### Testing URL',
    qc.testingUrl,
    '',
    '### Webpage Section',
    qc.section,
    '',
    '### Description (optional)',
    qc.additionalInfo,
    '',
    '### Actual Results',
    qc.actualResults,
    '',
    '### Expected Results',
    qc.expectedResults,
    '',
    '### Device Type',
    qc.deviceName,
    '',
    '### Enter Device Model',
    qc.otherDeviceName || '_No response_',
    '',
    '### Browser',
    qc.browser,
    '',
    '### Screen Resolution (For Responsiveness Issues)',
    qc.screenResolution || '_No response_',
    '',
    '### Steps to Reproduce (Optional)',
    qc.stepsToReproduce,
    '',
    '### Typography Property',
    ...typographyPropertiesForIssue(issue).map((property) => `- [x] ${property}`),
  ].join('\n');
}

function buildIssueUrl(repository: string, template: string, title: string, body: string, report: QAReport, match: ComponentMatch, scope: IssueDraftScope): string {
  const issue = scope.issue ?? match.issues[0];
  const qc = buildQcFields(report, match, issue, scope);
  const params = new URLSearchParams({
    template,
    title,
    type: 'Bug',
    body,
    'issue-type': qc.issueType,
    'testing-url': qc.testingUrl,
    section: qc.section,
    'additional-info': qc.additionalInfo,
    'actual-results': qc.actualResults,
    'expected-results': qc.expectedResults,
    'device-name': qc.deviceName,
    'other-device-name': qc.otherDeviceName,
    browsers: qc.browser,
    'screen-resolution': qc.screenResolution,
    'steps-to-reproduce': qc.stepsToReproduce,
  });

  for (const property of typographyPropertiesForIssue(issue)) {
    params.append('typography-properties', property);
  }

  return `https://github.com/${repository}/issues/new?${params.toString()}`;
}

function buildQcFields(report: QAReport, match: ComponentMatch, issue: Issue | undefined, scope: IssueDraftScope) {
  const screenResolution = screenResolutionForViewport(scope.viewport);
  return {
    issueType: 'UI',
    testingUrl: report.pageUrl,
    section: match.figmaNode.name || 'Component',
    additionalInfo: [
      'Automatically detected as a UI bug by DesignQA-AI.',
      `Component type: ${match.figmaNode.type}`,
      `Match score: ${Math.round(match.score)}%`,
      `Confidence: ${Math.round(match.confidence * 100)}%`,
      `Figma file key: ${report.figmaFileId}`,
      `Figma node ID: ${match.figmaNode.id}`,
      `Report ID: ${report.id}`,
      `Audit timestamp: ${report.timestamp}`,
    ].join('\n'),
    actualResults: issue
      ? [`${labelForIssue(issue)} detected on ${match.figmaNode.name}.`, `Actual: ${formatValue(issue.actual)}`, `Property: ${issue.property}`, `Severity: ${issue.severity}`].join('\n')
      : 'The component does not match the approved design and requires UI QA review.',
    expectedResults: issue ? `Expected: ${formatValue(issue.expected)}` : 'The component should match the approved Figma design.',
    deviceName: deviceNameForViewport(scope.viewport),
    otherDeviceName: screenResolution ? `Viewport ${screenResolution}` : '',
    browser: 'Chrome',
    screenResolution,
    stepsToReproduce: [`1. Open ${report.pageUrl}`, `2. Compare against Figma file ${report.figmaFileId}`, `3. Inspect the "${match.figmaNode.name}" section`, '4. Confirm the UI mismatch against the expected design value'].join('\n'),
  };
}

function pageLabelFromUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return 'Home';
    return path
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Page';
  } catch {
    return 'Page';
  }
}

function screenResolutionForViewport(viewport?: string): string {
  if (viewport === '1920') return '1920x1080';
  if (viewport === '1680') return '1680x1050';
  if (viewport === '1440' || viewport === 'desktop') return '1440x900';
  if (viewport === '1366') return '1366x768';
  if (viewport === '1024') return '1024x768';
  if (viewport === '810') return '810x1080';
  if (viewport === '425') return '425x932';
  if (viewport === 'mobile') return '375x812';
  if (viewport === 'tablet') return '768x1024';
  return '';
}

function deviceNameForViewport(viewport?: string): 'Desktop' | 'Mobile' | 'Tablet' {
  if (viewport === '425' || viewport === 'mobile') return 'Mobile';
  if (viewport === '810' || viewport === '1024' || viewport === 'tablet') return 'Tablet';
  return 'Desktop';
}

function typographyPropertiesForIssue(issue?: Issue): string[] {
  if (!issue || issue.type !== 'typography') return [];
  const property = issue.property.toLowerCase();
  const properties: string[] = [];
  if (property.includes('family')) properties.push('Font Family');
  if (property.includes('weight')) properties.push('Font Weight');
  if (property.includes('line')) properties.push('Line Height');
  if (property.includes('size')) properties.push('Font Size');
  if (property.includes('style')) properties.push('Font Style');
  if (property.includes('color') || property.includes('colour')) properties.push('Font Colour');
  return properties.length ? properties : ['Font Size'];
}

export function labelForIssue(issue: Issue): string {
  if (issue.type === 'presence') return 'Missing element';
  if (issue.type === 'layout') return 'Layout mismatch';
  if (issue.type === 'spacing') return 'Spacing mismatch';
  if (issue.type === 'typography') return 'Typography mismatch';
  if (issue.type === 'color') return 'Color mismatch';
  return 'Style mismatch';
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not available';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
