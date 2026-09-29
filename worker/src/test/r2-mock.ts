class MockR2ObjectBody implements R2ObjectBody {
  constructor(private readonly data: Uint8Array) {}

  get body(): ReadableStream<Uint8Array> | null {
    return null;
  }

  get bodyUsed(): boolean {
    return false;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer.slice(this.data.byteOffset, this.data.byteOffset + this.data.byteLength);
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data);
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async blob(): Promise<Blob> {
    return new Blob([this.data]);
  }
}

class MockR2Object implements R2Object {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: Date;
  readonly httpEtag: string;
  readonly checksums: R2Checksums;
  readonly version: string;
  readonly storageClass: string;
  readonly writeHttpMetadata: R2HTTPMetadata;

  constructor(key: string, data: Uint8Array) {
    this.key = key;
    this.size = data.byteLength;
    this.etag = "mock-etag";
    this.uploaded = new Date();
    this.httpEtag = "mock-etag";
    this.checksums = {};
    this.version = "mock-version";
    this.storageClass = "STANDARD";
    this.writeHttpMetadata = {};
  }
}

export class InMemoryR2Bucket implements R2Bucket {
  private readonly objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<R2ObjectBody | null> {
    const data = this.objects.get(key);
    if (!data) return null;
    return new MockR2ObjectBody(data);
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
  ): Promise<R2Object> {
    let data: Uint8Array;
    if (value instanceof Uint8Array) data = value;
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value === null) data = new Uint8Array();
    else throw new Error("unsupported mock R2 put value");
    this.objects.set(key, data);
    return new MockR2Object(key, data);
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) this.objects.delete(key);
  }

  async head(key: string): Promise<R2Object | null> {
    const data = this.objects.get(key);
    if (!data) return null;
    return new MockR2Object(key, data);
  }

  async list(_options?: R2ListOptions): Promise<R2Objects> {
    return { objects: [], truncated: false };
  }

  getStored(key: string): Uint8Array | undefined {
    return this.objects.get(key);
  }
}