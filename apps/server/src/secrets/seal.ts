// Mailbox-secret sealing (decision I's sibling — pulled forward from B7.1 on
// 2026-07-23 so B6.2 never stores plaintext). libsodium secretbox
// (XSalsa20-Poly1305) keyed by SECRET_KEY; sealed layout = nonce ‖ box.
// B7.1 adds rotation + the no-plaintext-at-rest proof on top of this.
import sodium from 'libsodium-wrappers';

export async function sealSecret(plaintext: string, keyHex: string): Promise<Buffer> {
  await sodium.ready;
  const key = Buffer.from(keyHex, 'hex'); // 32 bytes, validated by env schema
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(Buffer.from(plaintext, 'utf8'), nonce, key);
  return Buffer.concat([Buffer.from(nonce), Buffer.from(box)]);
}

export async function unsealSecret(sealed: Buffer, keyHex: string): Promise<string> {
  await sodium.ready;
  const key = Buffer.from(keyHex, 'hex');
  const nonce = sealed.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const box = sealed.subarray(sodium.crypto_secretbox_NONCEBYTES);
  const opened = sodium.crypto_secretbox_open_easy(box, nonce, key); // throws on tamper
  return Buffer.from(opened).toString('utf8');
}
