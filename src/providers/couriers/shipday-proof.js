'use strict';

// Shipday's incoming proofOfDelivery.imageUrls are the laundromat handoff.
// Pickup photos and return-delivery photos can show a customer's home.
const BUCKET = 'qt.com.dashboard.order.signature';
const MAX_BYTES = 10 * 1024 * 1024;
function photoUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const pathStyle = ['s3.us-west-2.amazonaws.com', 's3-us-west-2.amazonaws.com'].includes(url.hostname);
    const bucketStyle = [`${BUCKET}.s3.us-west-2.amazonaws.com`, `${BUCKET}.s3-us-west-2.amazonaws.com`].includes(url.hostname);
    const prefix = pathStyle ? `/${BUCKET}/` : '/';
    if ((!pathStyle && !bucketStyle) || !url.pathname.startsWith(prefix)) return null;
    const key = url.pathname.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(key)) return null;
    return url.href;
  } catch { return null; }
}
function deliveryPhotos(remote) {
  if (remote?.orderStatus?.orderState !== 'ALREADY_DELIVERED') return [];
  const urls = remote.proofOfDelivery?.imageUrls;
  // Do not guess that a signaturePath or pickup proof is a bag photograph.
  return Array.isArray(urls) ? [...new Set(urls.map(photoUrl).filter(Boolean))].slice(0, 20) : [];
}
function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
async function fetchPhoto(value, {fetchImpl = globalThis.fetch} = {}) {
  const url = photoUrl(value);
  if (!url) throw Error('Delivery photo unavailable.');
  // No API key, arbitrary hosts or redirects in this authenticated image proxy.
  const response = await fetchImpl(url, {redirect:'error', signal:AbortSignal.timeout(6000)});
  const suppliedType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  // Shipday's S3 uploads use the common image/jpg alias for JPEG bytes.
  const contentType = suppliedType === 'image/jpg' ? 'image/jpeg' : suppliedType;
  if (!response.ok || !['image/jpeg','image/png','image/webp'].includes(contentType) || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw Error('Delivery photo unavailable.');
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Error('Delivery photo unavailable.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (imageType(bytes) !== contentType) throw Error('Delivery photo unavailable.');
  return {bytes, contentType};
}
module.exports = {photoUrl, deliveryPhotos, fetchPhoto};
