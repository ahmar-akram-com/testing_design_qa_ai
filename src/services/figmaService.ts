import axios from 'axios';
import type { Layout, Styles, UINode } from '../types';

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const DEFAULT_MAX_FIGMA_NODES = Number(process.env.MAX_FIGMA_NODES || 250);
const DEFAULT_FIGMA_DEPTH = Number(process.env.FIGMA_FILE_DEPTH || 3);
const FIGMA_REQUEST_TIMEOUT_MS = Number(process.env.FIGMA_REQUEST_TIMEOUT_MS || 45000);
const FIGMA_REQUEST_RETRIES = Number(process.env.FIGMA_REQUEST_RETRIES || 5);
const FIGMA_RETRY_DELAY_CAP_MS = Number(process.env.FIGMA_RETRY_DELAY_CAP_MS || 5000);
const FIGMA_CACHE_TTL_MS = Number(process.env.FIGMA_CACHE_TTL_MS || 10 * 60 * 1000);
const FIGMA_STALE_CACHE_TTL_MS = Number(process.env.FIGMA_STALE_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

type CacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  data: T;
};

const sharedFigmaCache = new Map<string, CacheEntry<any>>();
const sharedFigmaInflight = new Map<string, Promise<any>>();

export class FigmaService {
  private fileCache = new Map<string, any>();
  private traversalCount = 0;
  private traversalLimit = DEFAULT_MAX_FIGMA_NODES;

  constructor(private accessToken: string) {}

  async checkToken(): Promise<boolean> {
    await this.requestWithRetry(() =>
        axios.get(`${FIGMA_API_BASE}/me`, {
          headers: { 'X-Figma-Token': this.accessToken },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }),
    );
    return true;
  }

  async extractFile(fileId: string, options?: { nodeId?: string; pageName?: string }): Promise<UINode[]> {
    this.traversalCount = 0;
    this.traversalLimit = DEFAULT_MAX_FIGMA_NODES;

    if (options?.nodeId) {
      const cacheKey = this.cacheKey(fileId, `node:${options.nodeId}:depth:${DEFAULT_FIGMA_DEPTH}`);
      const data = await this.cachedRequest(cacheKey, () =>
        axios.get(`${FIGMA_API_BASE}/files/${fileId}/nodes`, {
          headers: { 'X-Figma-Token': this.accessToken },
          params: { ids: options.nodeId, depth: DEFAULT_FIGMA_DEPTH },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }).then((response) => response.data),
      );

      const node = data.nodes?.[options.nodeId]?.document;
      if (!node) throw new Error(`Node ${options.nodeId} not found in file.`);

      if (node.type === 'CANVAS' || node.type === 'DOCUMENT') {
        return this.traverseNodes(node.children || []);
      }
      return this.traverseNodes([node]);
    }

    const fileCacheKey = this.cacheKey(fileId, `file:depth:${DEFAULT_FIGMA_DEPTH}`);
    let figmaFile = this.fileCache.get(fileCacheKey) || this.getCached(fileCacheKey);
    if (!figmaFile) {
      figmaFile = await this.cachedRequest(fileCacheKey, () =>
        axios.get(`${FIGMA_API_BASE}/files/${fileId}`, {
          headers: { 'X-Figma-Token': this.accessToken },
          params: { depth: DEFAULT_FIGMA_DEPTH },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }).then((response) => response.data),
      );
      this.fileCache.set(fileCacheKey, figmaFile);
    }

    const document = figmaFile.document;
    const page = options?.pageName
      ? document.children.find((child: any) => child.name === options.pageName)
      : document.children[0];

    if (!page) throw new Error(`Page ${options?.pageName} not found`);
    return this.traverseNodes(page.children || []);
  }

  async getNodesImages(fileId: string, nodeIds: string[]): Promise<Record<string, string>> {
    if (nodeIds.length === 0) return {};

    const uniqueNodeIds = [...new Set(nodeIds)];
    const batches = this.chunk(uniqueNodeIds, 25);
    const images: Record<string, string> = {};

    for (const batch of batches) {
      const batchImages = await this.getNodesImagesBatch(fileId, batch);
      Object.assign(images, batchImages);
    }

    return images;
  }

  private async getNodesImagesBatch(fileId: string, nodeIds: string[]): Promise<Record<string, string>> {
    try {
      const response = await this.requestWithRetry(() =>
        axios.get(`${FIGMA_API_BASE}/images/${fileId}`, {
          headers: { 'X-Figma-Token': this.accessToken },
          params: { ids: nodeIds.join(','), format: 'png' },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }),
      );
      return response.data.images || {};
    } catch (error) {
      console.error('Failed to fetch Figma node images:', error);
      return {};
    }
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  async getImageBuffer(url: string): Promise<Buffer> {
    const response = await this.requestWithRetry(() => axios.get(url, { responseType: 'arraybuffer', timeout: FIGMA_REQUEST_TIMEOUT_MS }));
    return Buffer.from(response.data, 'binary');
  }

  async requestWithRetry<T>(fn: () => Promise<T>, retries = FIGMA_REQUEST_RETRIES, delay = 1500): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Figma API request timed out after ${Math.round(FIGMA_REQUEST_TIMEOUT_MS / 1000)} seconds. Use a specific Figma frame/node URL instead of scanning a whole file.`);
      }

      if (error.response) {
        const { status, data } = error.response;

        if (status === 429 && retries > 0) {
          const retryAfter = error.response.headers['retry-after'];
          const requestedDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 || delay : delay;
          const nextDelay = Math.min(requestedDelay, FIGMA_RETRY_DELAY_CAP_MS);
          await new Promise((resolve) => setTimeout(resolve, nextDelay));
          return this.requestWithRetry(fn, retries - 1, Math.min(nextDelay * 2, 30000));
        }

        if (status === 429) {
          throw this.httpError(429, 'Figma API rate limit exceeded. Wait a moment and run the comparison again, or use a more specific Figma frame/component URL.', 'FIGMA_RATE_LIMIT');
        }

        if (status === 401) {
          throw new Error('Figma API 401 Unauthorized: FIGMA_ACCESS_TOKEN is invalid or expired.');
        }

        if (status === 403) {
          throw new Error('Figma API 403 Forbidden: token lacks permission to access this resource.');
        }

        if (status === 404) {
          throw new Error('Figma API 404 Not Found: file or node was not found, or token lacks file access.');
        }

        throw new Error(`Figma API ${status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      }

      throw error;
    }
  }

  private traverseNodes(nodes: any[]): UINode[] {
    const normalizedNodes: UINode[] = [];
    for (const node of nodes) {
      if (this.traversalCount >= this.traversalLimit) break;
      const normalized = this.normalizeNode(node);
      if (normalized) normalizedNodes.push(normalized);
    }
    return normalizedNodes;
  }

  private normalizeNode(node: any): UINode | null {
    if (this.traversalCount >= this.traversalLimit) return null;
    if (node.visible === false) return null;

    const interestTypes = ['FRAME', 'COMPONENT', 'INSTANCE', 'TEXT', 'RECTANGLE', 'VECTOR', 'GROUP', 'SECTION'];
    if (!interestTypes.includes(node.type)) return null;
    this.traversalCount += 1;

    const layout: Layout = {
      x: node.absoluteBoundingBox?.x || 0,
      y: node.absoluteBoundingBox?.y || 0,
      width: node.absoluteBoundingBox?.width || 0,
      height: node.absoluteBoundingBox?.height || 0,
    };

    const styles: Styles = {};

    if (node.type === 'TEXT') {
      styles.fontSize = node.style?.fontSize;
      styles.fontWeight = node.style?.fontWeight;
      styles.fontFamily = node.style?.fontFamily;
      styles.lineHeight = node.style?.lineHeightPx;

      const fill = node.fills?.[0];
      if (fill?.type === 'SOLID') styles.color = this.figmaColorToHex(fill.color);
    }

    const bgFill = node.fills?.find((fill: any) => fill.type === 'SOLID');
    if (bgFill) styles.backgroundColor = this.figmaColorToHex(bgFill.color);
    if (node.cornerRadius) styles.borderRadius = `${node.cornerRadius}px`;
    if (node.paddingLeft || node.paddingTop) {
      styles.padding = `${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px`;
    }

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      layout,
      styles,
      text: node.characters,
      children: node.children && this.traversalCount < this.traversalLimit ? this.traverseNodes(node.children) : [],
    };
  }

  private figmaColorToHex(color: { r: number; g: number; b: number }): string {
    const toHex = (channel: number) => Math.round(channel * 255).toString(16).padStart(2, '0');
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  }

  private cacheKey(fileId: string, scope: string) {
    return `${this.accessToken.length}:${this.accessToken.slice(-10)}:${fileId}:${scope}`;
  }

  private getCached<T>(key: string): T | null {
    return this.readCache<T>(key, false);
  }

  private getStaleCached<T>(key: string): T | null {
    return this.readCache<T>(key, true);
  }

  private readCache<T>(key: string, allowStale: boolean): T | null {
    const cached = sharedFigmaCache.get(key);
    if (!cached) return null;
    const now = Date.now();
    if (cached.expiresAt > now || (allowStale && cached.staleUntil > now)) {
      return cached.data as T;
    }
    if (cached.staleUntil <= now) {
      sharedFigmaCache.delete(key);
    }
    return null;
  }

  private async cachedRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const cached = this.getCached<T>(key);
    if (cached) return cached;

    const inflight = sharedFigmaInflight.get(key);
    if (inflight) return inflight as Promise<T>;

    const request = fn()
      .then((data) => {
        sharedFigmaCache.set(key, {
          data,
          expiresAt: Date.now() + FIGMA_CACHE_TTL_MS,
          staleUntil: Date.now() + FIGMA_STALE_CACHE_TTL_MS,
        });
        return data;
      })
      .catch((error) => {
        if (this.isRateLimitError(error)) {
          const stale = this.getStaleCached<T>(key);
          if (stale) return stale;
        }
        throw error;
      })
      .finally(() => sharedFigmaInflight.delete(key));

    sharedFigmaInflight.set(key, request);
    return request;
  }

  private httpError(statusCode: number, message: string, code?: string) {
    const error = new Error(message) as Error & { statusCode: number; code?: string };
    error.statusCode = statusCode;
    error.code = code;
    return error;
  }

  private isRateLimitError(error: any) {
    const message = String(error?.message || '');
    return (
      error?.statusCode === 429 ||
      error?.response?.status === 429 ||
      error?.code === 'FIGMA_RATE_LIMIT' ||
      message.includes('status code 429') ||
      message.includes('HTTP 429') ||
      message.toLowerCase().includes('rate limit')
    );
  }
}
