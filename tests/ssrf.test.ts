import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress, safeUrl, fetchPublic} from '../services/fetch-broker/fetch';

test('SSRF: publicAddress rejects all private, local, metadata, and reserved IPv4/IPv6 ranges', () => {
  const blockedAddresses = [
    // Loopback IPv4 & IPv6
    '127.0.0.1',
    '127.0.0.2',
    '127.255.255.254',
    '::1',

    // RFC 1918 Private IPv4
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.1.254',

    // Cloud Metadata & Link-Local IPv4 (169.254.0.0/16)
    '169.254.169.254',
    '169.254.1.1',

    // IPv4-mapped IPv6 loopback, private & metadata
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:192.168.1.1',

    // IPv6 Unique-Local & Link-Local
    'fc00::1',
    'fd00::1',
    'fd00:ec2::254', // AWS metadata IPv6
    'fe80::1',

    // Carrier Grade NAT (100.64.0.0/10)
    '100.64.0.1',
    '100.127.255.255',

    // Unspecified, Broadcast & Multicast
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '239.255.255.255',
    'ff02::1',

    // Malformed / Non-IP strings
    'not-an-ip',
    '999.999.999.999',
    '',
  ];

  for (const addr of blockedAddresses) {
    assert.equal(publicAddress(addr), false, `Address ${addr} should be blocked`);
  }

  // Legitimate public unicast addresses must be allowed
  const allowedAddresses = [
    '8.8.8.8',
    '1.1.1.1',
    '142.250.190.46',
    '2607:f8b0:4005:805::200e',
  ];

  for (const addr of allowedAddresses) {
    assert.equal(publicAddress(addr), true, `Public address ${addr} should be allowed`);
  }
});

test('SSRF: safeUrl enforces public HTTPS scheme, standard port 443, and rejects userinfo', () => {
  // Protocol enforcement
  assert.throws(() => safeUrl('http://example.com'), /Only public HTTPS/);
  assert.throws(() => safeUrl('file:///etc/passwd'), /Only public HTTPS/);
  assert.throws(() => safeUrl('ftp://ftp.example.com'), /Only public HTTPS/);
  assert.throws(() => safeUrl('gopher://gopher.floodgap.com'), /Only public HTTPS/);

  // Credential / userinfo injection
  assert.throws(() => safeUrl('https://admin:secret@example.com'), /credentials/i);
  assert.throws(() => safeUrl('https://user@example.com'), /credentials/i);

  // Non-standard ports
  assert.throws(() => safeUrl('https://example.com:8080/'), /Only public HTTPS/);
  assert.throws(() => safeUrl('https://example.com:8443/'), /Only public HTTPS/);
  assert.throws(() => safeUrl('https://example.com:22/'), /Only public HTTPS/);

  // Localhost hostnames
  assert.throws(() => safeUrl('https://localhost/'), /Only public HTTPS/);
  assert.throws(() => safeUrl('https://localhost./'), /Only public HTTPS/);

  // Valid HTTPS URL should pass and have hash stripped
  const u = safeUrl('https://example.com/about#section-1');
  assert.equal(u.protocol, 'https:');
  assert.equal(u.hostname, 'example.com');
  assert.equal(u.hash, '');
});

test('SSRF: fetchPublic rejects redirect loops and excessive hops', async () => {
  // Redirect count > 4 throws 'Too many redirects'
  await assert.rejects(
    fetchPublic('https://example.com', 5),
    /Too many redirects/
  );
});
