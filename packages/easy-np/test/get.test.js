const fs = require('node:fs');
const assert = require('node:assert');
const path = require('node:path');
const assertFile = require('assert-file');
const mm = require('mm');

const mockNprc = path.join(__dirname, './fixtures/auth/');
if (!fs.existsSync(path.join(mockNprc, '.nprc'))) {
  fs.writeFileSync(
    path.join(mockNprc, '.nprc'),
    'registry=https://registry-mock.org/\n//registry-mock.org/:always-auth=true\n//registry-mock.org/:_password="bW9jaw=="\n//registry-mock.org/:username=hyj19911120'
  );
}
mm(process.env, 'HOME', mockNprc);
mm(process.env, 'USERPROFILE', mockNprc);
// clean np_config.js cache
delete require.cache[require.resolve('../lib/get')];
delete require.cache[require.resolve('../lib/np_config')];
const get = require('../lib/get');
mm.restore();

describe('test/get.test.js', () => {
  it('should retry on JSON parse error', async () => {
    const logger = {
      warn(msg) {
        assert(msg.includes('[np:get] retry GET') || msg.includes('[np:get:error] GET'));
      },
    };
    try {
      await get('https://r.cnpmjs.org/binary.html', { dataType: 'json' }, { console: logger });
      assert(false, 'should not run this');
    } catch (err) {
      assert.equal(err.name, 'JSONResponseFormatError');
      assert(err.res.requestUrls.length > 0);
    }
  });

  it('should set auth info into header', async () => {
    const logger = {
      warn(msg) {
        assert(msg.includes('[np:get] retry GET') || msg.includes('[np:get:error] GET'));
      },
    };
    const options = { dataType: 'json' };
    assertFile(path.join(mockNprc, '.nprc'));
    try {
      await get('https://registry-mock.org/mock', options, { console: logger });
      assert(false, 'should not run this');
    } catch (err) {
      console.error(err);
      const headers = options.headers;
      assert(headers.Authorization);
      assert(err.message.includes('ENOTFOUND') || err.message.includes('Connect Timeout Error'), err.message);
      assert(err.res.requestUrls.length > 0);
    }
  });

  // 依赖 urllib 3 内置的 undici(>= 5.28)在跨源重定向时去掉认证头; 降级 urllib 或改为自行跟随重定向时必须保持这一行为
  for (const streaming of [false, true]) {
    it(`should drop Authorization on cross-origin redirect, streaming: ${streaming}`, async () => {
      const http = require('node:http');
      const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      let receivedAuth = 'not requested';
      const target = http.createServer((req, res) => {
        receivedAuth = req.headers.authorization;
        res.end('ok');
      });
      await listen(target);
      const origin = http.createServer((req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/tarball` });
        res.end();
      });
      await listen(origin);
      try {
        const result = await get(
          `http://127.0.0.1:${origin.address().port}/manifest`,
          { headers: { Authorization: 'Bearer secret' }, followRedirect: true, streaming, retry: 0 },
          { console: { warn() {} } }
        );
        if (streaming) {
          for await (const _ of result.res);
        }
        assert.equal(result.status, 200);
        assert.equal(receivedAuth, undefined);
      } finally {
        origin.close();
        target.close();
      }
    });
  }
});
