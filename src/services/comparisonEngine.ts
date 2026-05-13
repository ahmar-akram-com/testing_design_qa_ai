import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { ComponentMatch, Issue, UINode } from '../types';

export interface ComparisonConfig {
  layoutTolerance?: number;
  spacingTolerance?: number;
  typographyTolerance?: number;
  preset?: string;
}

export class ComparisonEngine {
  private config: Required<ComparisonConfig>;

  constructor(config: ComparisonConfig = {}) {
    this.config = {
      layoutTolerance: config.layoutTolerance ?? 15,
      spacingTolerance: config.spacingTolerance ?? 2,
      typographyTolerance: config.typographyTolerance ?? 1,
      preset: config.preset ?? 'none',
    };
  }

  compare(matches: ComponentMatch[]): ComponentMatch[] {
    if (this.config.preset === 'tailwind') this.config.spacingTolerance = Math.max(this.config.spacingTolerance, 4);
    if (this.config.preset === 'mui') this.config.spacingTolerance = Math.max(this.config.spacingTolerance, 8);
    if (this.config.preset === 'bootstrap') this.config.typographyTolerance = Math.max(this.config.typographyTolerance, 2);

    return matches.map((match) => {
      if (!match.domNode) {
        match.issues = [{ type: 'presence', property: 'exists', expected: true, actual: false, severity: 'high' }];
        match.score = 0;
        return match;
      }

      match.issues = this.generateIssues(match.figmaNode, match.domNode);
      match.score = this.calculateScore(match.issues);
      return match;
    });
  }

  async generateVisualDiffFromBase64(figmaBase64: string, domBase64: string): Promise<{ diffBase64: string; mismatch: number }> {
    try {
      const figmaPng = PNG.sync.read(Buffer.from(figmaBase64, 'base64'));
      const domPng = PNG.sync.read(Buffer.from(domBase64, 'base64'));
      const width = Math.max(figmaPng.width, domPng.width);
      const height = Math.max(figmaPng.height, domPng.height);
      const figmaResized = this.resizeImage(figmaPng, width, height);
      const domResized = this.resizeImage(domPng, width, height);
      const diff = new PNG({ width, height });
      const numDiffPixels = pixelmatch(figmaResized.data, domResized.data, diff.data, width, height, { threshold: 0.1 });
      return {
        diffBase64: PNG.sync.write(diff).toString('base64'),
        mismatch: (numDiffPixels / (width * height)) * 100,
      };
    } catch (error) {
      console.error('Visual diff failed:', error);
      return { diffBase64: '', mismatch: 100 };
    }
  }

  private generateIssues(f: UINode, d: UINode): Issue[] {
    const issues: Issue[] = [];
    const visualDiffBase64 = this.generateBoundingBoxDiff(f, d);

    if (Math.abs(f.layout.width - d.layout.width) > this.config.layoutTolerance || Math.abs(f.layout.height - d.layout.height) > this.config.layoutTolerance) {
      issues.push({
        type: 'layout',
        property: 'dimensions',
        expected: `${Math.round(f.layout.width)}x${Math.round(f.layout.height)}`,
        actual: `${Math.round(d.layout.width)}x${Math.round(d.layout.height)}`,
        severity: 'medium',
        visualDiffBase64,
      });
    }

    if (f.styles.padding && d.styles.padding && Math.abs(parseFloat(f.styles.padding) - parseFloat(d.styles.padding)) > this.config.spacingTolerance) {
      issues.push({ type: 'spacing', property: 'padding', expected: f.styles.padding, actual: d.styles.padding, severity: 'low', visualDiffBase64 });
    }

    if (f.styles.fontSize && d.styles.fontSize && Math.abs(f.styles.fontSize - d.styles.fontSize) > this.config.typographyTolerance) {
      issues.push({ type: 'typography', property: 'fontSize', expected: f.styles.fontSize, actual: d.styles.fontSize, severity: 'low', visualDiffBase64 });
    }

    if (f.styles.fontWeight && d.styles.fontWeight && String(f.styles.fontWeight) !== String(d.styles.fontWeight)) {
      issues.push({ type: 'typography', property: 'fontWeight', expected: f.styles.fontWeight, actual: d.styles.fontWeight, severity: 'low', visualDiffBase64 });
    }

    if (f.styles.lineHeight && d.styles.lineHeight && Math.abs(f.styles.lineHeight - d.styles.lineHeight) > Math.max(this.config.typographyTolerance, 2)) {
      issues.push({ type: 'typography', property: 'lineHeight', expected: `${f.styles.lineHeight.toFixed(1)}px`, actual: `${d.styles.lineHeight.toFixed(1)}px`, severity: 'low', visualDiffBase64 });
    }

    if (f.type === 'TEXT' && f.text && d.text) {
      const expectedChars = new Set(f.text.replace(/\s+/g, '').split(''));
      const actualChars = new Set(d.text.replace(/\s+/g, '').split(''));
      const missingChars = [...expectedChars].filter((char) => !actualChars.has(char));
      if (missingChars.length > 0) {
        issues.push({ type: 'typography', property: 'characterSubset', expected: 'All expected characters present', actual: `Missing characters: ${missingChars.join('')}`, severity: 'medium', visualDiffBase64 });
      }
    }

    return issues;
  }

  private calculateScore(issues: Issue[]): number {
    let score = 100;
    for (const issue of issues) {
      if (issue.type === 'presence') score -= 10;
      else if (issue.type === 'layout') score -= 15;
      else if (issue.type === 'spacing') score -= 12;
      else if (issue.type === 'typography') score -= 10;
      else if (issue.type === 'color') score -= 7;
      else score -= 5;
    }
    return Math.max(0, score);
  }

  private generateBoundingBoxDiff(f: UINode, d: UINode): string | undefined {
    const padding = 20;
    const width = Math.ceil(Math.max(f.layout.width, d.layout.width)) + padding * 2;
    const height = Math.ceil(Math.max(f.layout.height, d.layout.height)) + padding * 2;
    if (width <= 0 || height <= 0 || width >= 5000 || height >= 5000) return undefined;

    const png = new PNG({ width, height });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 240;
      png.data[i + 1] = 240;
      png.data[i + 2] = 240;
      png.data[i + 3] = 128;
    }

    this.drawBox(png, padding, padding, f.layout.width, f.layout.height, [0, 80, 255, 255]);
    this.drawBox(png, padding, padding, d.layout.width, d.layout.height, [255, 60, 60, 255]);
    return PNG.sync.write(png).toString('base64');
  }

  private drawBox(png: PNG, x: number, y: number, width: number, height: number, rgba: [number, number, number, number], strokeWidth = 2) {
    x = Math.round(x);
    y = Math.round(y);
    width = Math.round(width);
    height = Math.round(height);

    for (let i = 0; i < png.width; i++) {
      for (let j = 0; j < png.height; j++) {
        const isTop = j >= y && j < y + strokeWidth && i >= x && i < x + width;
        const isBottom = j >= y + height - strokeWidth && j < y + height && i >= x && i < x + width;
        const isLeft = i >= x && i < x + strokeWidth && j >= y && j < y + height;
        const isRight = i >= x + width - strokeWidth && i < x + width && j >= y && j < y + height;
        if (isTop || isBottom || isLeft || isRight) {
          const idx = (png.width * j + i) << 2;
          png.data[idx] = rgba[0];
          png.data[idx + 1] = rgba[1];
          png.data[idx + 2] = rgba[2];
          png.data[idx + 3] = rgba[3];
        }
      }
    }
  }

  private resizeImage(png: PNG, width: number, height: number): PNG {
    if (png.width === width && png.height === height) return png;
    const resized = new PNG({ width, height });
    PNG.bitblt(png, resized, 0, 0, png.width, png.height, 0, 0);
    return resized;
  }
}
