import dgram from 'node:dgram';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export function dnsResponder(policy, now = Date.now) {
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(policy.hostname || '') ||
      !Number.isInteger(policy.maxDnsRequests) || policy.maxDnsRequests < 1 || policy.maxDnsRequests > 256 ||
      !Array.isArray(policy.addresses) || !policy.addresses.length || policy.addresses.length > 32 || !Number.isSafeInteger(policy.expires_at)) throw new Error('INVALID_DNS_POLICY');
  const addresses = policy.addresses.map(a => ipaddr.parse(a)); let requests = 0;
  return packet => {
    if (!Buffer.isBuffer(packet) || packet.length < 12 || packet.length > 512 || packet.readUInt16BE(4) !== 1 || (packet.readUInt16BE(2) & 0xf800)) return null;
    requests++;
    let offset = 12; const labels = [];
    while (offset < packet.length && packet[offset]) {
      const size = packet[offset++]; if (size > 63 || offset + size > packet.length || labels.length > 126) return null;
      const bytes = packet.subarray(offset, offset + size); if (bytes.some(b => b > 127)) return null;
      const label = bytes.toString('ascii');
      if (!/^[a-z0-9-]+$/iu.test(label)) return null;
      labels.push(label); offset += size;
    }
    if (offset + 5 > packet.length) return null;
    offset++; const type = packet.readUInt16BE(offset); const queryClass = packet.readUInt16BE(offset + 2); offset += 4;
    const header = Buffer.alloc(12); packet.copy(header, 0, 0, 2);
    const expired = now() >= policy.expires_at || requests > policy.maxDnsRequests;
    const permitted = labels.join('.').toLowerCase() === policy.hostname && queryClass === 1;
    const rcode = expired ? 2 : permitted ? 0 : 3;
    header.writeUInt16BE(0x8400 | (packet.readUInt16BE(2) & 0x0100) | rcode, 2); header.writeUInt16BE(1, 4);
    const question = packet.subarray(12, offset); const answers = [];
    if (rcode === 0 && [1,28].includes(type)) {
      for (const address of addresses.filter(a => a.kind() === (type === 1 ? 'ipv4' : 'ipv6'))) {
        const data = Buffer.from(address.toByteArray()); const answer = Buffer.alloc(12);
        answer.writeUInt16BE(0xc00c, 0); answer.writeUInt16BE(type, 2); answer.writeUInt16BE(1, 4);
        answer.writeUInt32BE(Math.max(0, Math.min(30, Math.floor((policy.expires_at - now()) / 1000))), 6);
        answer.writeUInt16BE(data.length, 10); answers.push(Buffer.concat([answer, data]));
      }
    }
    header.writeUInt16BE(answers.length, 6);
    const response = Buffer.concat([header, question, ...answers]);
    if (response.length > 512) { header.writeUInt16BE(header.readUInt16BE(2) | 0x0200, 2); header.writeUInt16BE(0, 6); return Buffer.concat([header, question]); }
    return response;
  };
}
export async function serveDns(policy) {
  const respond = dnsResponder(policy); const udp = dgram.createSocket('udp4');
  udp.on('message', (packet, peer) => { const response = respond(packet); if (response) udp.send(response, peer.port, peer.address); });
  const tcp = net.createServer(socket => {
    socket.setTimeout(1000, () => socket.destroy()); let pending = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]); if (pending.length > 514) return socket.destroy();
      if (pending.length < 2) return;
      const length = pending.readUInt16BE(0); if (length > 512 || length < 12) return socket.destroy();
      if (pending.length !== length + 2) return;
      const response = respond(pending.subarray(2)); if (!response) return socket.destroy();
      const prefix = Buffer.alloc(2); prefix.writeUInt16BE(response.length); socket.end(Buffer.concat([prefix, response]));
    });
  });
  tcp.maxConnections = 8;
  await Promise.all([new Promise((resolve, reject) => udp.once('error', reject).bind(53,'127.0.0.1',resolve)),
    new Promise((resolve, reject) => tcp.once('error',reject).listen(53,'127.0.0.1',resolve))]);
  return () => { udp.close(); tcp.close(); };
}
