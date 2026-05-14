export interface Layout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Styles {
  fontSize?: number;
  fontWeight?: string | number;
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  padding?: string;
  margin?: string;
  borderRadius?: string;
  fontFamily?: string;
  opacity?: number;
  visibility?: string;
}

export interface UINode {
  id: string;
  name: string;
  type: 'TEXT' | 'FRAME' | 'COMPONENT' | 'INSTANCE' | 'ELEMENT' | 'BUTTON' | 'IMAGE' | string;
  layout: Layout;
  styles: Styles;
  text?: string;
  children?: UINode[];
}

export interface Issue {
  type: 'layout' | 'spacing' | 'typography' | 'color' | 'presence' | 'style';
  property: string;
  expected: unknown;
  actual: unknown;
  severity: 'high' | 'medium' | 'low';
  visualDiffBase64?: string;
}

export interface ComponentMatch {
  figmaNode: UINode;
  domNode: UINode | null;
  confidence: number;
  issues: Issue[];
  score: number;
  visualDiff?: string;
  figmaNodeImage?: string;
  domNodeImage?: string;
}

export interface QAReport {
  id: string;
  timestamp: string;
  figmaFileId: string;
  pageUrl: string;
  overallScore: number;
  designMatch?: {
    status: 'matched' | 'mismatch' | 'unknown';
    score: number;
    message: string;
    figmaSignals: string[];
    targetSignals: string[];
    matchedSignals: string[];
    checkName?: string;
    reason?: string;
  };
  matches: ComponentMatch[];
  screenshot?: string;
  summary: {
    totalComponents: number;
    matchedComponents: number;
    totalIssues: number;
    passCount: number;
    failCount: number;
  };
}
