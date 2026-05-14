import axios from 'axios';
import type { Layout, Styles, UINode } from '../types';

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const DEFAULT_MAX_FIGMA_NODES = Number(process.env.MAX_FIGMA_NODES || 250);
const DEFAULT_FIGMA_DEPTH = Number(process.env.FIGMA_FILE_DEPTH || 3);
const FIGMA_REQUEST_TIMEOUT_MS = Number(process.env.FIGMA_REQUEST_TIMEOUT_MS || 45000);
const FIGMA_REQUEST_RETRIES = Number(process.env.FIGMA_REQUEST_RETRIES || 5);

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
      const response = await this.requestWithRetry(() =>
        axios.get(`${FIGMA_API_BASE}/files/${fileId}/nodes`, {
          headers: { 'X-Figma-Token': this.accessToken },
          params: { ids: options.nodeId },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }),
      );

      const node = response.data.nodes?.[options.nodeId]?.document;
      if (!node) throw new Error(`Node ${options.nodeId} not found in file.`);

      if (node.type === 'CANVAS' || node.type === 'DOCUMENT') {
        return this.traverseNodes(node.children || []);
      }
      return this.traverseNodes([node]);
    }

    let figmaFile = this.fileCache.get(fileId);
    if (!figmaFile) {
      const response = await this.requestWithRetry(() =>
        axios.get(`${FIGMA_API_BASE}/files/${fileId}`, {
          headers: { 'X-Figma-Token': this.accessToken },
          params: { depth: DEFAULT_FIGMA_DEPTH },
          timeout: FIGMA_REQUEST_TIMEOUT_MS,
        }),
      );
      figmaFile = response.data;
      this.fileCache.set(fileId, figmaFile);
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
          const nextDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 || delay : delay;
          await new Promise((resolve) => setTimeout(resolve, nextDelay));
          return this.requestWithRetry(fn, retries - 1, Math.min(nextDelay * 2, 30000));
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
}
