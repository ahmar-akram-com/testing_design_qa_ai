import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type { Layout, UINode } from '../types.ts';

export class DOMCaptureService {
  private browser?: Browser;
  private page?: Page;

  async start(url: string, viewportName = 'desktop'): Promise<{ nodes: UINode[]; screenshot: string }> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const viewport = this.viewportFor(viewportName);
    const context = await this.browser.newContext({
      viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    this.page = await context.newPage();

    try {
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    } catch {
      await this.page.goto(url, { waitUntil: 'load', timeout: 20000 });
    }

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);

    const fullHeight = await this.page.evaluate<number>('document.documentElement.scrollHeight');
    const fullWidth = await this.page.evaluate<number>('document.documentElement.scrollWidth');
    const limitHeight = Math.max(viewport.height, Math.min(fullHeight, 5000));
    const limitWidth = Math.max(viewport.width, fullWidth);

    await this.page.setViewportSize({ width: limitWidth, height: limitHeight });

    const screenshotBuffer = await this.page.screenshot({
      clip: { x: 0, y: 0, width: limitWidth, height: limitHeight },
    });

    const nodes = await this.page.evaluate<UINode | null>(`(() => {
      const traverse = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && el.children.length === 0) return null;

        const computed = window.getComputedStyle(el);
        if (computed.display === 'none' || computed.visibility === 'hidden' || parseFloat(computed.opacity) < 0.1) {
          return null;
        }

        const children = [];
        const source = el.shadowRoot || el;
        for (const child of Array.from(source.children)) {
          const childNode = traverse(child);
          if (childNode) children.push(childNode);
        }

        let type = 'ELEMENT';
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'body') type = 'FRAME';
        else if (tagName === 'button' || el.getAttribute('role') === 'button') type = 'BUTTON';
        else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'label', 'li'].includes(tagName)) type = 'TEXT';
        else if (tagName === 'img' || tagName === 'svg') type = 'IMAGE';

        const src = el.getAttribute('src') || '';
        const srcName = src.split('/').pop() || '';
        const identityText = [
          el.getAttribute('alt'),
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          srcName,
        ].filter(Boolean).join(' ').trim();

        return {
          id: el.id || 'dom-' + Math.random().toString(36).slice(2, 11),
          name: tagName,
          type,
          layout: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          },
          styles: {
            fontSize: parseFloat(computed.fontSize),
            fontWeight: computed.fontWeight,
            fontFamily: computed.fontFamily,
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            padding: computed.padding,
            margin: computed.margin,
            borderRadius: computed.borderRadius,
            lineHeight: parseFloat(computed.lineHeight) || undefined,
          },
          text: el.children.length === 0 ? (identityText || el.textContent?.trim() || '').slice(0, 100) : identityText.slice(0, 100) || undefined,
          children: children.length > 0 ? children : undefined,
        };
      };

      return traverse(document.body);
    })()`);

    return {
      nodes: nodes ? [nodes] : [],
      screenshot: screenshotBuffer.toString('base64'),
    };
  }

  async captureNodeImage(layout: Layout): Promise<string> {
    if (!this.page) throw new Error('Browser not started');

    try {
      const viewport = this.page.viewportSize() || { width: 1440, height: 900 };
      const x = Math.max(0, Math.round(layout.x));
      const y = Math.max(0, Math.round(layout.y));
      let width = Math.max(1, Math.round(layout.width));
      let height = Math.max(1, Math.round(layout.height));

      if (x + width > viewport.width) width = viewport.width - x;
      if (y + height > viewport.height) height = viewport.height - y;
      if (width < 1 || height < 1 || x >= viewport.width || y >= viewport.height) return '';

      const buffer = await this.page.screenshot({ clip: { x, y, width, height } });
      return buffer.toString('base64');
    } catch (error: any) {
      console.warn('Failed to capture node image:', error.message);
      return '';
    }
  }

  async close() {
    await this.browser?.close();
  }

  private viewportFor(name: string) {
    if (name === '1920') return { width: 1920, height: 1080 };
    if (name === '1680') return { width: 1680, height: 1050 };
    if (name === '1440' || name === 'desktop') return { width: 1440, height: 900 };
    if (name === '1366') return { width: 1366, height: 768 };
    if (name === '1024') return { width: 1024, height: 768 };
    if (name === '810') return { width: 810, height: 1080 };
    if (name === '425') return { width: 425, height: 932 };
    if (name === 'mobile') return { width: 375, height: 812 };
    if (name === 'tablet') return { width: 768, height: 1024 };
    return { width: 1440, height: 900 };
  }
}
