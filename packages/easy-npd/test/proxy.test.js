const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');
const proxy = require('../lib/proxy');
const get = require('../lib/get');

describe('test/proxy.test.js', () => {
  const originalEnv = { ...process.env };
  let target;
  let proxyServer;
  let tunnels;
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  before(async () => {
    target = http.createServer((req, res) => res.end('ok'));
    proxyServer = http.createServer();
    proxyServer.on('connect', (req, socket, head) => {
      tunnels.push(req.url);
      const [host, port] = req.url.split(':');
      const upstream = net.connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
    });
    await listen(target);
    await listen(proxyServer);
  });

  beforeEach(() => {
    tunnels = [];
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    proxy.configure({ proxy: false, 'https-proxy': false });
  });

  after(() => {
    target.close();
    proxyServer.close();
  });

  const targetUrl = () => `http://127.0.0.1:${target.address().port}/manifest`;
  const proxyUrl = () => `http://127.0.0.1:${proxyServer.address().port}`;

  it('should send requests through --proxy and pass it to child processes', async () => {
    proxy.configure({ proxy: proxyUrl() });
    const result = await get(targetUrl(), { retry: 0 }, { console: { warn() {} } });
    assert.equal(result.status, 200);
    assert.deepEqual(tunnels, [`127.0.0.1:${target.address().port}`]);
    for (const name of ['HTTP_PROXY', 'http_proxy', 'npm_config_proxy', 'HTTPS_PROXY', 'npm_config_https_proxy']) {
      assert.equal(process.env[name], proxyUrl(), name);
    }
  });

  it('should connect directly for hosts in --noproxy', async () => {
    proxy.configure({ proxy: proxyUrl(), noproxy: 'example.com, 127.0.0.1' });
    const result = await get(targetUrl(), { retry: 0 }, { console: { warn() {} } });
    assert.equal(result.status, 200);
    assert.deepEqual(tunnels, []);
    assert.equal(process.env.NO_PROXY, 'example.com, 127.0.0.1');
  });

  it('should read HTTP_PROXY when no option is given', async () => {
    process.env.HTTP_PROXY = proxyUrl();
    delete process.env.npm_config_proxy;
    proxy.configure({});
    await get(targetUrl(), { retry: 0 }, { console: { warn() {} } });
    assert.equal(tunnels.length, 1);
  });

  it('should disable strict ssl for child processes', () => {
    proxy.configure({ 'strict-ssl': false });
    assert.equal(process.env.npm_config_strict_ssl, 'false');
    assert.equal(process.env.GIT_SSL_NO_VERIFY, 'true');
    assert.deepEqual(proxy.tlsOptions(), { rejectUnauthorized: false });
  });

  it('should let --strict-ssl override npm_config_strict_ssl=false', () => {
    process.env.npm_config_strict_ssl = 'false';
    proxy.configure({ 'strict-ssl': true });
    assert.equal(proxy.tlsOptions(), undefined);
  });

  describe('credentials', () => {
    const [root, cleanup] = helper.tmp();
    before(cleanup);
    after(cleanup);

    it('should not print proxy credentials to stderr or npd-debug.log', async () => {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      const env = { ...process.env, np_lockfile: 'false' };
      for (const name of ['NO_PROXY', 'no_proxy', 'npm_config_noproxy']) delete env[name];
      await coffee
        .fork(
          helper.npminstall,
          [
            'npd-redact-test-not-exists',
            '--registry=http://127.0.0.1:1',
            '--proxy=http://user:s3cret@127.0.0.1:1',
            '--https-proxy=http://user:s3cret@127.0.0.1:1',
          ],
          { cwd: root, env }
        )
        .expect('code', 1)
        .notExpect('stderr', /s3cret/)
        .notExpect('stdout', /s3cret/)
        .end();
      const log = await fs.readFile(path.join(root, 'npd-debug.log'), 'utf8');
      assert.match(log, /\*\*\*@127\.0\.0\.1:1/);
      assert.doesNotMatch(log, /s3cret/);
    });
  });

  it('should match NO_PROXY entries like curl', () => {
    const match = (url, entries) => proxy.matchNoProxy(new URL(url), entries);
    assert(match('https://a.example.com/x', ['example.com']));
    assert(match('https://example.com/x', ['.example.com']));
    assert(match('https://a.b.example.com/x', ['*.example.com']));
    assert(match('http://host:8080/x', ['host:8080']));
    assert(match('http://anything/x', ['*']));
    assert(!match('https://badexample.com/x', ['example.com']));
    assert(!match('http://host/x', ['host:8080']));
  });
});
