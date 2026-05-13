import type { ComponentMatch, UINode } from '../types';

export class MappingEngine {
  matchNodes(figmaNodes: UINode[], domNodes: UINode[]): ComponentMatch[] {
    const flattenedFigma = this.flatten(figmaNodes);
    const flattenedDOM = this.flatten(domNodes);

    return flattenedFigma.map((figmaNode) => {
      let bestMatch: { node: UINode; score: number } | null = null;

      for (const domNode of flattenedDOM) {
        const score = this.calculateSimilarity(figmaNode, domNode);
        if (score > 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { node: domNode, score };
        }
      }

      return {
        figmaNode,
        domNode: bestMatch?.node || null,
        confidence: bestMatch?.score || 0,
        issues: [],
        score: 0,
      };
    });
  }

  private calculateSimilarity(f: UINode, d: UINode): number {
    let score = 0;
    if (this.isSimilarType(f, d)) score += 0.4;

    if (f.text && d.text) {
      score += this.stringSimilarity(f.text, d.text) * 0.4;
    } else if (!f.text && !d.text) {
      score += 0.2;
    }

    const ratioF = (f.layout.width || 1) / (f.layout.height || 1);
    const ratioD = (d.layout.width || 1) / (d.layout.height || 1);
    const ratioDiff = Math.abs(ratioF - ratioD) / Math.max(ratioF, ratioD);

    if (ratioDiff < 0.2) score += 0.4;
    else if (ratioDiff < 0.5) score += 0.2;
    else if (ratioDiff < 0.8) score += 0.1;

    return Math.min(score, 1);
  }

  private isSimilarType(f: UINode, d: UINode): boolean {
    const fType = f.type.toUpperCase();
    const dName = d.name.toLowerCase();
    if (fType === 'TEXT' && (d.type === 'TEXT' || ['a', 'label', 'li', 'span', 'p'].includes(dName) || /^h[1-6]$/.test(dName))) return true;
    if (['FRAME', 'GROUP', 'SECTION'].includes(fType) && ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'ul', 'ol', 'form', 'body'].includes(dName)) return true;
    if (['COMPONENT', 'INSTANCE'].includes(fType) && ['div', 'section', 'article', 'li', 'button', 'a'].includes(dName)) return true;
    if ((f.name.toLowerCase().includes('button') || f.name.toLowerCase().includes('btn')) && (dName === 'button' || d.type === 'BUTTON' || dName === 'a')) return true;
    if (['RECTANGLE', 'VECTOR', 'ELLIPSE', 'POLYGON', 'STAR'].includes(fType) && ['svg', 'img', 'div', 'span'].includes(dName)) return true;
    return false;
  }

  private stringSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length > shorter.length * 2) return 0;
    if (longer.length > 200) return s1.slice(0, 50) === s2.slice(0, 50) ? 0.5 : 0;
    return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  private editDistance(s1: string, s2: string): number {
    const costs: number[] = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  private flatten(nodes: UINode[]): UINode[] {
    return nodes.flatMap((node) => [node, ...(node.children ? this.flatten(node.children) : [])]);
  }
}
