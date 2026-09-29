export function pkcs7Pad(data: Uint8Array, blockSize = 16): Uint8Array {
  const padLen = blockSize - (data.length % blockSize || blockSize);
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  out.fill(padLen, data.length);
  return out;
}

export function pkcs7Unpad(data: Uint8Array, blockSize = 16): Uint8Array {
  if (!data.length || data.length % blockSize !== 0) {
    throw new Error("invalid PKCS7 data");
  }
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > blockSize) {
    throw new Error("invalid PKCS7 padding");
  }
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error("invalid PKCS7 padding");
  }
  return data.slice(0, data.length - padLen);
}