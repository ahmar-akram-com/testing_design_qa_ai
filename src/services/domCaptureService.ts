import type { Browser, Page } from 'playwright';
import type { Layout, UINode } from '../types';

export class DOMCaptureService {
  private browser?: Browser;
  private page?: Page;

  async start(url: string, viewportName = 'desktop', options: { includeScreenshot?: boolean } = {}): Promise<{ nodes: UINode[]; screenshot: string }> {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
    const { chromium: playwrightChromium } = await import('playwright');
    const launchOptions = await this.getLaunchOptions();

    this.browser = await playwrightChromium.launch({
      headless: true,
      ...launchOptions,
    });

    const viewport = this.viewportFor(viewportName);
    const context = await this.browser.newContext({
      viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    this.page = await context.newPage();
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
    const networkTimeout = isServerless ? 12000 : 25000;
    const loadTimeout = isServerless ? 9000 : 20000;
    const settleDelay = isServerless ? 500 : 1500;

    try {
      await this.page.goto(url, { waitUntil: isServerless ? 'domcontentloaded' : 'networkidle', timeout: networkTimeout });
    } catch {
      await this.page.goto(url, { waitUntil: 'load', timeout: loadTimeout });
    }

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(settleDelay);

    const fullHeight = await this.page.evaluate<number>('document.documentElement.scrollHeight');
    const fullWidth = await this.page.evaluate<number>('document.documentElement.scrollWidth');
    const limitHeight = Math.max(viewport.height, Math.min(fullHeight, isServerless ? 2200 : 5000));
    const limitWidth = Math.max(viewport.width, fullWidth);

    await this.page.setViewportSize({ width: limitWidth, height: limitHeight });

    const screenshot = options.includeScreenshot === false ? '' : (await this.page.screenshot({
      clip: { x: 0, y: 0, width: limitWidth, height: limitHeight },
    })).toString('base64');

    const maxDomNodes = Number(process.env.MAX_DOM_NODES || (isServerless ? 220 : 1200));
    const nodes = await this.page.evaluate<UINode | null>(`(() => {
      const maxNodes = ${Math.max(25, Math.floor(maxDomNodes))};
      let visitedNodes = 0;
      const traverse = (el) => {
        if (visitedNodes >= maxNodes) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && el.children.length === 0) return null;

        const computed = window.getComputedStyle(el);
        if (computed.display === 'none' || computed.visibility === 'hidden' || parseFloat(computed.opacity) < 0.1) {
          return null;
        }
        visitedNodes += 1;

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
      screenshot,
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

  private async getLaunchOptions() {
    const fallbackArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

    if (!isServerless) {
      return { args: fallbackArgs };
    }

    const chromium = (await import('@sparticuz/chromium')).default;
    chromium.setGraphicsMode = false;

    return {
      args: [...chromium.args, '--disable-dev-shm-usage', '--disable-gpu'],
      executablePath: await chromium.executablePath(),
    };
  }
}
